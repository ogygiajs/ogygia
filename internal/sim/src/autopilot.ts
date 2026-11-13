/**
 * THE LEDGER AUTOPILOT. Moves failure sites (src/failures.ts) out of the baseline in bulk, so only
 * the sites no test reaches are left for hand work.
 *
 * 1. Map: each baseline site of a package gets a probe on its recovery path (a catch's body, a
 *    `.catch` or rejection handler, a `!res.ok` or STALE or null-body check when it holds, a throw, an
 *    `{ ok: false }`). The package's tests run once per test project (src/autopilot-setup.ts records
 *    each test's probe hits, src/autopilot-reporter.ts writes them), and the probes come out.
 * 2. Prove: each reached site's recovery is broken (an operator per kind: a catch emptied or made to
 *    rethrow, a handler made to rethrow, a check never true, a throw removed, a failed result made
 *    ok), and only the tests that reached it run again, under a time limit. A reaching test that
 *    fails, and fails again on a second run of the same mutant (the re-run rule), proves the site
 *    `covered` by that test. A site whose every mutant leaves its tests green SURVIVED: a test runs
 *    the path and checks nothing about it.
 * 3. Out: `map.json`, `results.jsonl` (one line per judged site, so a stopped run resumes),
 *    `patch.json` (the covered entries), `report.json` and `report.md` (proved, survived, unreached,
 *    and the kinds no operator breaks), all under `--out`.
 *
 * The source is put back after every probe pass and every mutant, and checked byte for byte; a
 * Ctrl-C puts back what is changed and stops the run's vitest.
 *
 *   node src/autopilot.ts --package core [--project node] [--project browser] [--out <dir>]
 *     [--skip <file of site ids>] [--only <text>] [--limit <n>] [--timeout-s <s>] [--remap] [--apply]
 *
 * `--apply` writes `patch.json` into internal/sim/failures.json (baseline to covered).
 * test/autopilot.test.ts.
 */
import { spawn } from 'node:child_process';
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseSync } from 'rolldown/utils';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import type { RanTest, RunFile } from './autopilot-reporter.ts';
import {
	FAILURE_LEDGER,
	read_failure_ledger,
	scope_files,
	site_nodes,
	type Covered,
	type FailureLedger,
	type Node,
	type SiteKind,
	type SiteNode
} from './failures.ts';

/** A change to a source: `[at, end)` becomes `text` (an insertion when `at === end`). `nest` orders
 *  insertions at one offset: a wrap's opening is `[1, -span]` (the outer opens first), its closing
 *  `[0, span]` (the inner closes first, and before anything opens there). */
export interface Edit {
	readonly at: number;
	readonly end: number;
	readonly text: string;
	readonly nest?: readonly [number, number];
}

/** One recovery-breaking change of a site. */
export interface SiteMutant {
	readonly operator: string;
	/** What it breaks, as a reason says it. */
	readonly says: string;
	readonly edits: readonly Edit[];
}

/** A site proved covered: the ledger's {@link Covered} entry. */
export type Proof = Covered;

const probe_call = (id: string): string =>
	`(globalThis as any).__ogygia_autopilot?.(${JSON.stringify(id)})`;

const wrap = (n: { start: number; end: number }, open: string, close: string): Edit[] => {
	const span = n.end - n.start;
	return [
		{ at: n.start, end: n.start, text: open, nest: [1, -span] },
		{ at: n.end, end: n.end, text: close, nest: [0, span] }
	];
};

const truthy = (id: string) => `((v: any) => (v && ${probe_call(id)}, v))(`;
const falsy = (id: string) => `((v: any) => (!v && ${probe_call(id)}, v))(`;
const NEGATED: ReadonlySet<string> = new Set(['!==', '!=']);

/** The handler argument a `.catch` or rejection site's recovery runs in, or null. */
function handler_of(s: SiteNode): Node | null {
	const args = s.node.arguments as Node[] | undefined;
	const h = args?.[s.kind === '.catch' ? 0 : 1];
	return h === undefined || h.type === 'SpreadElement' ? null : h;
}

/** The condition a check site is (`!res.ok`, `x === STALE`, `!x.body`, `x.body === null`), and
 *  whether it holds on the recovery path when true. */
function check_of(s: SiteNode): { node: Node; when: boolean } | null {
	if (s.kind === 'not-ok')
		return s.parent?.type === 'UnaryExpression' ? { node: s.parent, when: true } : null;
	if (s.node.type === 'UnaryExpression') return { node: s.node, when: true };
	if (s.node.type === 'BinaryExpression')
		return { node: s.node, when: !NEGATED.has(String(s.node.operator)) };
	return null;
}

/** The probe on a site's recovery path, or null when its kind has none. */
export function probe_of(s: SiteNode): Edit[] | null {
	const p = probe_call(s.id);
	switch (s.kind) {
		case 'catch': {
			const body = s.node.body as Node;
			return [{ at: body.start + 1, end: body.start + 1, text: `${p};` }];
		}
		case 'throw':
			return wrap(s.node.argument as Node, `(${p}, `, ')');
		case '.catch':
		case 'reject': {
			const h = handler_of(s);
			return h === null
				? null
				: wrap(
						h,
						`((h: any) => typeof h === 'function' ? (...a: any[]) => (${p}, h(...a)) : h)(`,
						')'
					);
		}
		case 'not-ok':
		case 'stale':
		case 'body': {
			const c = check_of(s);
			return c === null ? null : wrap(c.node, c.when ? truthy(s.id) : falsy(s.id), ')');
		}
		case 'result':
			return wrap(s.node.value as Node, `(${p}, `, ')');
		default:
			return null;
	}
}

/** The kinds the autopilot probes and breaks. */
export const AUTOPILOT_KINDS: ReadonlySet<SiteKind> = new Set([
	'catch',
	'.catch',
	'reject',
	'not-ok',
	'stale',
	'body',
	'throw',
	'result'
]);

const RETHROW = '(e: unknown) => { throw e; }';

/** The recovery-breaking mutants of a site, in the order they are tried. */
export function mutants_of(s: SiteNode): SiteMutant[] {
	const replace = (n: { start: number; end: number }, text: string): Edit => ({
		at: n.start,
		end: n.end,
		text
	});
	switch (s.kind) {
		case 'catch': {
			const body = s.node.body as Node;
			const param = s.node.param as Node | null;
			const out: SiteMutant[] = [];
			if ((body.body as Node[]).length > 0)
				out.push({
					operator: 'empty',
					says: 'the catch body emptied',
					edits: [replace(body, '{}')]
				});
			const rethrow =
				param !== null && param.type === 'Identifier'
					? [replace(body, `{ throw ${String(param.name)}; }`)]
					: [
							replace(
								{ start: s.node.start, end: body.end },
								'catch (autopilot_error) { throw autopilot_error; }'
							)
						];
			out.push({
				operator: 'rethrow',
				says: 'the catch made to rethrow',
				edits: rethrow
			});
			return out;
		}
		case '.catch':
		case 'reject': {
			const h = handler_of(s);
			if (h === null) return [];
			return [
				{
					operator: 'rethrow',
					says:
						s.kind === '.catch'
							? 'the .catch handler made to rethrow'
							: 'the rejection handler made to rethrow',
					edits: [replace(h, RETHROW)]
				}
			];
		}
		case 'not-ok':
		case 'stale':
		case 'body': {
			const c = check_of(s);
			if (c === null) return [];
			const what =
				s.kind === 'not-ok'
					? 'the not-ok branch never taken'
					: s.kind === 'stale'
						? 'the STALE check never true'
						: 'the null-body check never true';
			return [
				{
					operator: 'never',
					says: what,
					edits: [replace(c.node, c.when ? 'false' : 'true')]
				}
			];
		}
		case 'throw':
			return [
				{
					operator: 'drop',
					says: 'the throw removed',
					edits: [replace(s.node, '{}')]
				}
			];
		case 'result':
			return [
				{
					operator: 'ok',
					says: 'the failed result made ok',
					edits: [replace(s.node.value as Node, 'true')]
				}
			];
		default:
			return [];
	}
}

/** `source` with `edits` made. Replacements may not overlap one another. */
export function apply_edits(source: string, edits: readonly Edit[]): string {
	const sorted = [...edits].sort(
		(a, b) =>
			a.at - b.at ||
			a.end - b.end ||
			(a.nest?.[0] ?? 0) - (b.nest?.[0] ?? 0) ||
			(a.nest?.[1] ?? 0) - (b.nest?.[1] ?? 0)
	);
	let out = '';
	let at = 0;
	for (const e of sorted) {
		if (e.at < at) throw new Error(`edits overlap at ${e.at}`);
		out += source.slice(at, e.at) + e.text;
		at = e.end;
	}
	return out + source.slice(at);
}

/** `source` with a probe on each of `ids`' recovery paths (the ones a probe can mark). */
export function probed(file: string, source: string, ids: ReadonlySet<string>): string {
	const edits = site_nodes(file, source)
		.filter((s) => ids.has(s.id))
		.flatMap((s) => probe_of(s) ?? []);
	return apply_edits(source, edits);
}

/** Whether `source` parses (a mutant that does not is never run). */
function parses(file: string, source: string): boolean {
	return parseSync(file, source).errors.length === 0;
}

// ── runs ─────────────────────────────────────────────────────────────────────────────────────────

/** A test that reached a site. */
export interface Reach {
	readonly project: string;
	/** Its file, from the repo root. */
	readonly test: string;
	readonly name: string;
	readonly full: string;
}

/** A site whose every mutant left its tests green. */
export interface Survivor {
	readonly site: string;
	readonly operators: readonly string[];
	readonly tests: readonly Reach[];
}

export interface AutopilotReport {
	readonly package: string;
	readonly baseline: number;
	readonly proved: Proof[];
	readonly survived: Survivor[];
	/** Sites of a probed kind no test reached. */
	readonly unreached: string[];
	/** Sites of a kind the autopilot has no probe or operator for. */
	readonly unhandled: string[];
	/** Sites left out (`--skip`) or not judged yet (`--limit`, `--only`). */
	readonly skipped: string[];
}

export interface AutopilotOptions {
	readonly root: string;
	readonly pkg: string;
	/** The baseline's site ids (the ones in other packages are ignored). */
	readonly baseline: readonly string[];
	readonly out: string;
	/** The vitest binary (default: the package's own). */
	readonly vitest?: string;
	/** The test projects to run, each on its own (`null`: the config's own, no `--project`). */
	readonly projects: readonly (string | null)[];
	readonly exclude?: FailureLedger['scope']['exclude'];
	readonly skip?: ReadonlySet<string>;
	readonly only?: string;
	readonly limit?: number;
	/** The time limit of a mutant's run (a run past it is stopped and counts as failing). */
	readonly timeout_ms: number;
	/** The time limit of a map run (default: ten mutant limits). */
	readonly map_timeout_ms?: number;
	/** Map again even when `map.json` is there. */
	readonly remap?: boolean;
	readonly quiet?: boolean;
}

/** Each source file changed now, with its text as it was: put back by {@link restore}. */
const changed = new Map<string, string>();
let child: ReturnType<typeof spawn> | null = null;

function change(abs: string, text: string): void {
	if (!changed.has(abs)) changed.set(abs, readFileSync(abs, 'utf8'));
	writeFileSync(abs, text);
}

/** Puts back every changed file and checks it byte for byte; throws when one is not. */
function restore(): void {
	for (const [abs, text] of changed) {
		writeFileSync(abs, text);
		if (readFileSync(abs, 'utf8') !== text) throw new Error(`${abs}: not put back byte for byte`);
		changed.delete(abs);
	}
}

function stop_child(): void {
	const c = child;
	if (c?.pid === undefined) return;
	try {
		process.kill(-c.pid, 'SIGKILL');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
	}
}

const CONFIGS: readonly string[] = ['vitest.config.ts', 'vitest.config.js', 'vite.config.ts'];

/** The vitest config a run uses: the package's own, with the probe recorder in each project and
 *  the autopilot's reporter alone. */
function wrapper_config(pkgdir: string, out: string): string {
	const base = CONFIGS.map((c) => join(pkgdir, c)).find((c) => existsSync(c));
	if (base === undefined) throw new Error(`${pkgdir}: no vitest config`);
	const setup = resolve(import.meta.dirname, 'autopilot-setup.ts');
	const reporter = resolve(import.meta.dirname, 'autopilot-reporter.ts');
	const file = join(out, 'vitest.autopilot.config.mts');
	writeFileSync(
		file,
		dedent`
			import base from ${JSON.stringify(base)};
			const made: any = typeof base === 'function' ? await (base as any)({ command: 'serve', mode: 'test' }) : await base;
			const test = (made.test ??= {});
			const add = (t: any) => { t.setupFiles = [...[t.setupFiles ?? []].flat(), ${JSON.stringify(setup)}]; };
			const projects = Array.isArray(test.projects) && test.projects.every((p: any) => p && typeof p === 'object');
			if (projects) for (const p of test.projects) add((p.test ??= {}));
			else add(test);
			test.reporters = [${JSON.stringify(reporter)}];
			made.root = ${JSON.stringify(pkgdir)};
			export default made;
		`
	);
	return file;
}

interface Ran {
	readonly run: RunFile;
	readonly timed_out: boolean;
}

/** One vitest run: `files` (absolute; all when empty) of `project`, results through the reporter. */
async function run_vitest(
	o: AutopilotOptions,
	config: string,
	project: string | null,
	files: readonly string[],
	label: string,
	limit_ms: number
): Promise<Ran> {
	const pkgdir = join(o.root, 'packages', o.pkg);
	const result = join(o.out, 'run.json');
	rmSync(result, { force: true });
	const log = openSync(join(o.out, 'run.log'), 'w');
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(process.env))
		if (!k.startsWith('VITEST') && !k.startsWith('TINYPOOL')) env[k] = v;
	env.OGYGIA_AUTOPILOT_OUT = result;
	const vitest = o.vitest ?? join(pkgdir, 'node_modules', '.bin', 'vitest');
	const args = ['run', '--config', config, '--maxWorkers=2'];
	if (project !== null) args.push('--project', project);
	args.push(...files);
	const started = Date.now();
	let timed_out = false;
	await new Promise<void>((done) => {
		const c = spawn(vitest, args, {
			cwd: pkgdir,
			env,
			detached: true,
			stdio: ['ignore', log, log]
		});
		child = c;
		const timer = setTimeout(() => {
			timed_out = true;
			stop_child();
		}, limit_ms);
		c.on('exit', () => {
			clearTimeout(timer);
			child = null;
			done();
		});
	});
	closeSync(log);
	if (!o.quiet)
		console.log(
			`  ${label}: ${Math.round((Date.now() - started) / 1000)}s${timed_out ? ' (timed out)' : ''}`
		);
	if (!existsSync(result)) {
		if (timed_out) return { run: { tests: [], hits: [] }, timed_out };
		throw new Error(`${label}: vitest wrote no results (its output: ${join(o.out, 'run.log')})`);
	}
	return {
		run: JSON.parse(readFileSync(result, 'utf8')) as RunFile,
		timed_out
	};
}

interface Judged {
	readonly site: string;
	readonly verdict: 'proved' | 'survived' | 'no-mutant';
	readonly proof?: Proof;
	readonly operators?: readonly string[];
}

const has_name = (text: string, name: string): boolean =>
	text.includes(`'${name}'`) || text.includes(`"${name}"`) || text.includes(`\`${name}\``);

/** Runs the autopilot over one package. */
export async function autopilot(o: AutopilotOptions): Promise<AutopilotReport> {
	const root = realpathSync(o.root);
	const opts = { ...o, root };
	mkdirSync(o.out, { recursive: true });
	const pkgdir = join(root, 'packages', o.pkg);
	const baseline = new Set(o.baseline);
	const files = scope_files(root, {
		packages: [o.pkg],
		exclude: o.exclude ?? []
	});
	const sources = new Map(files.map((f) => [f, readFileSync(join(root, f), 'utf8')]));
	const sites: SiteNode[] = files.flatMap((f) =>
		site_nodes(f, sources.get(f)!).filter((s) => baseline.has(s.id))
	);
	const unhandled = sites
		.filter(
			(s) => !AUTOPILOT_KINDS.has(s.kind) || probe_of(s) === null || mutants_of(s).length === 0
		)
		.map((s) => s.id);
	const no_op = new Set(unhandled);
	const skipped: string[] = [];
	const wanted = sites.filter((s) => {
		if (no_op.has(s.id)) return false;
		if (o.skip?.has(s.id) || (o.only !== undefined && !s.id.includes(o.only))) {
			skipped.push(s.id);
			return false;
		}
		return true;
	});
	const config = wrapper_config(pkgdir, o.out);

	const on_signal = () => {
		stop_child();
		restore();
		process.exit(130);
	};
	process.on('SIGINT', on_signal);
	process.on('SIGTERM', on_signal);
	try {
		// map
		const map_file = join(o.out, 'map.json');
		let reach: Record<string, Reach[]>;
		if (!o.remap && existsSync(map_file)) reach = JSON.parse(readFileSync(map_file, 'utf8'));
		else {
			reach = {};
			const ids = new Set(wanted.map((s) => s.id));
			for (const project of o.projects) {
				for (const f of new Set(wanted.map((s) => s.file)))
					change(join(root, f), probed(f, sources.get(f)!, ids));
				let ran: Ran;
				try {
					ran = await run_vitest(
						opts,
						config,
						project,
						[],
						`map ${project ?? o.pkg}`,
						o.map_timeout_ms ?? o.timeout_ms * 10
					);
				} finally {
					restore();
				}
				const by_id = new Map(ran.run.tests.map((t) => [t.id, t]));
				for (const h of ran.run.hits) {
					const t = by_id.get(h.test);
					if (t === undefined || t.state !== 'passed') continue;
					for (const id of h.hits) {
						if (!ids.has(id)) continue;
						(reach[id] ??= []).push({
							project: t.project,
							test: relative(root, t.file),
							name: t.name,
							full: t.full
						});
					}
				}
			}
			writeFileSync(map_file, `${JSON.stringify(reach, null, '\t')}\n`);
		}

		// prove
		const results_file = join(o.out, 'results.jsonl');
		const judged = new Map<string, Judged>();
		if (existsSync(results_file))
			for (const line of readFileSync(results_file, 'utf8').split('\n'))
				if (line.trim()) {
					const j = JSON.parse(line) as Judged;
					judged.set(j.site, j);
				}
		let budget = o.limit ?? Number.POSITIVE_INFINITY;
		for (const s of wanted) {
			const tests = reach[s.id];
			if (tests === undefined || judged.has(s.id)) continue;
			if (budget-- <= 0) {
				skipped.push(s.id);
				continue;
			}
			const j = await judge(opts, config, s, sources.get(s.file)!, tests);
			judged.set(s.id, j);
			appendFileSync(results_file, `${JSON.stringify(j)}\n`);
			if (!o.quiet) console.log(`${j.verdict}: ${s.id}`);
		}

		const proved: Proof[] = [];
		const survived: Survivor[] = [];
		const unreached: string[] = [];
		for (const s of wanted) {
			const j = judged.get(s.id);
			if (reach[s.id] === undefined) unreached.push(s.id);
			else if (j?.verdict === 'proved' && j.proof) proved.push(j.proof);
			else if (j?.verdict === 'survived')
				survived.push({
					site: s.id,
					operators: j.operators ?? [],
					tests: reach[s.id]
				});
		}
		const report: AutopilotReport = {
			package: o.pkg,
			baseline: sites.length,
			proved,
			survived,
			unreached,
			unhandled,
			skipped
		};
		writeFileSync(join(o.out, 'patch.json'), `${JSON.stringify(proved, null, '\t')}\n`);
		writeFileSync(join(o.out, 'report.json'), `${JSON.stringify(report, null, '\t')}\n`);
		writeFileSync(join(o.out, 'report.md'), report_md(report));
		return report;
	} finally {
		restore();
		process.off('SIGINT', on_signal);
		process.off('SIGTERM', on_signal);
	}
}

/** Breaks `s`'s recovery, one operator at a time, and reruns the tests that reached it. */
async function judge(
	o: AutopilotOptions,
	config: string,
	s: SiteNode,
	source: string,
	tests: readonly Reach[]
): Promise<Judged> {
	const abs = join(o.root, s.file);
	const tried: string[] = [];
	for (const m of mutants_of(s)) {
		const text = apply_edits(source, m.edits);
		if (!parses(s.file, text)) continue;
		tried.push(m.operator);
		const failing = async (): Promise<(Reach & { hung: boolean })[]> => {
			const out: (Reach & { hung: boolean })[] = [];
			for (const project of new Set(tests.map((t) => t.project))) {
				const mine = tests.filter((t) => t.project === project);
				const files = [...new Set(mine.map((t) => join(o.root, t.test)))];
				change(abs, text);
				let ran: Ran;
				try {
					ran = await run_vitest(
						o,
						config,
						project || null,
						files,
						`${m.operator} ${s.id}`,
						o.timeout_ms
					);
				} finally {
					restore();
				}
				const state = new Map(
					ran.run.tests.map((t: RanTest) => [`${relative(o.root, t.file)}\0${t.full}`, t.state])
				);
				for (const t of mine) {
					const st = state.get(`${t.test}\0${t.full}`);
					if (st === 'failed') out.push({ ...t, hung: false });
					else if (ran.timed_out && st === undefined) out.push({ ...t, hung: true });
				}
			}
			return out;
		};
		const first = await failing();
		if (first.length === 0) continue;
		const again = await failing();
		const both = first
			.filter((t) => again.some((a) => a.test === t.test && a.full === t.full))
			.sort((a, b) => Number(a.hung) - Number(b.hung));
		const named = both.find((t) => has_name(readFileSync(join(o.root, t.test), 'utf8'), t.name));
		if (named === undefined) continue;
		const red = named.hung ? 'hangs the test past the run time limit' : 'turns the test red';
		return {
			site: s.id,
			verdict: 'proved',
			proof: {
				site: s.id,
				reason: `a test reaches its recovery path; proved by the autopilot: ${m.says} ${red}`,
				test: named.test,
				name: named.name
			}
		};
	}
	return {
		site: s.id,
		verdict: tried.length === 0 ? 'no-mutant' : 'survived',
		operators: tried
	};
}

/** The report as Markdown. */
export function report_md(r: AutopilotReport): string {
	const list = (xs: readonly string[]) => xs.map((x) => `- \`${x}\``).join('\n');
	return [
		`# Autopilot: packages/${r.package}`,
		'',
		`Baseline sites: ${r.baseline}. Proved: ${r.proved.length}. Survived: ${r.survived.length}. Unreached: ${r.unreached.length}. No operator: ${r.unhandled.length}. Skipped: ${r.skipped.length}.`,
		'',
		'## Proved (baseline to covered)',
		'',
		r.proved.map((p) => `- \`${p.site}\`: ${p.test} › ${p.name}`).join('\n'),
		'',
		'## Survived (a test reaches the path and checks nothing about it)',
		'',
		r.survived
			.map(
				(s) =>
					`- \`${s.site}\` (${s.operators.join(', ')}): ${s.tests
						.slice(0, 3)
						.map((t) => `${t.test} › ${t.name}`)
						.join('; ')}${s.tests.length > 3 ? `; +${s.tests.length - 3}` : ''}`
			)
			.join('\n'),
		'',
		'## Unreached (no test runs the recovery path)',
		'',
		list(r.unreached),
		'',
		'## No operator (kinds the autopilot does not break)',
		'',
		list(r.unhandled),
		''
	].join('\n');
}

/** `ledger` with `proofs` moved from the baseline to covered. */
export function merge_patch(ledger: FailureLedger, proofs: readonly Proof[]): FailureLedger {
	const baseline = new Set(ledger.baseline);
	for (const p of proofs)
		if (!baseline.has(p.site)) throw new Error(`not in the baseline: ${p.site}`);
	const moved = new Set(proofs.map((p) => p.site));
	return {
		...ledger,
		covered: [
			...ledger.covered,
			...proofs.map(({ site, reason, test, name }) => ({
				site,
				reason,
				test,
				name
			}))
		],
		baseline: ledger.baseline.filter((b) => !moved.has(b))
	};
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

function args_of(flag: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < process.argv.length; i++)
		if (process.argv[i] === flag && process.argv[i + 1] !== undefined)
			out.push(process.argv[i + 1]);
	return out;
}

async function main(): Promise<void> {
	const pkg = args_of('--package')[0];
	if (pkg === undefined) throw new Error('--package <name> is needed');
	const ledger = read_failure_ledger();
	const out = resolve(
		args_of('--out')[0] ?? join(ROOT, 'internal', 'sim', '.scratch', 'autopilot', pkg)
	);
	const skip = new Set(
		args_of('--skip').flatMap((f) =>
			readFileSync(f, 'utf8')
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean)
		)
	);
	const projects = args_of('--project');
	const report = await autopilot({
		root: ROOT,
		pkg,
		baseline: ledger.baseline,
		out,
		projects: projects.length > 0 ? projects : [null],
		exclude: ledger.scope.exclude,
		skip,
		only: args_of('--only')[0],
		limit: args_of('--limit')[0] === undefined ? undefined : Number(args_of('--limit')[0]),
		timeout_ms: Number(args_of('--timeout-s')[0] ?? 180) * 1000,
		remap: process.argv.includes('--remap')
	});
	console.log(
		`packages/${pkg}: ${report.baseline} in the baseline; proved ${report.proved.length}, survived ${report.survived.length}, unreached ${report.unreached.length}, no operator ${report.unhandled.length}, skipped ${report.skipped.length} (${out})`
	);
	if (process.argv.includes('--apply')) {
		const next = merge_patch(read_failure_ledger(), report.proved);
		writeFileSync(FAILURE_LEDGER, `${JSON.stringify(next, null, '\t')}\n`);
		console.log(`wrote ${FAILURE_LEDGER}: ${next.baseline.length} in the baseline`);
	}
}

if (process.argv[1] === import.meta.filename) await main();
