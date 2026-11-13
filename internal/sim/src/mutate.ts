/**
 * MUTATION TESTING THROUGH THE SIMULATOR. A mutant is one change at one line of a package's source
 * (`{ file, in, code, nth?, operator, from?, to? }`, the file from the repo root; its line is found
 * by its function and its code, never a stored line number). Each is applied, ONE at a
 * time, to a sandbox: a copy-on-write clone of the repo outside it (never the real tree), where its
 * package and the ones that depend on it are built (`turbo run build`), then each target app (a
 * generated app's seed, or the palaestra) is built and a fixed seed set runs (4 workers, `nice`).
 * The mutant is KILLED when a seed finds what it did not find on the code as it is (the baseline,
 * run first in the same sandbox), when a seed does not finish, or when the build fails; else it
 * SURVIVED: the simulator missed it, which names a missing oracle or app shape. test/mutate.test.ts.
 *
 *   node src/mutate.ts --mutants <file.json> [--gens 191,192,550+33+36] [--palaestra] [--seeds 20]
 *     [--jobs 4] [--sandbox <dir>] [--out <file.jsonl>] [--budget-min <minutes>]
 *     [--buggify-aim <points>]
 *   node src/mutate.ts --mutants <file.json> --compiler-dst [--dst-runs 100] [--sandbox <dir>]
 *
 * `--compiler-dst` judges the list on the compiler's simulator (`internal/compiler-dst`, which
 * compiles the package sources, so nothing is built): a mutant is killed by a test that fails on it
 * twice and not on the baseline.
 *
 * `--buggify-aim` runs every seed, the baseline's too, with only those buggify points on (cli.ts):
 * a point its app asks rarely proves its recovery this way.
 *
 * One line per mutant goes to `--out` as it is judged (what it was, killed or survived, by what),
 * and at the end the kill rate, how many of the list were judged (a time budget stops it starting
 * more) and when.
 */
import { spawnSync } from 'node:child_process';
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { signature } from './ci.ts';
import { function_at, functions_of } from './failures.ts';

export interface Mutant {
	/** A name for it (the list's own, or `<file> > <in>:<operator>`). */
	readonly id?: string;
	/** From the repo root: `packages/<pkg>/src/...`. */
	readonly file: string;
	/** The innermost named function around its line, as a failure site's id names it
	 *  (`Class > method`, `fn > inner`; `(module)` for top-level code). No line number is stored: a
	 *  list outlives its files' lines moving. */
	readonly in: string;
	/** The line's own code (trimmed): the mutant goes on the line in {@link Mutant.in} that holds it. */
	readonly code: string;
	/** Which of the lines in its function that hold `code` (0-based), when more than one does: a
	 *  mutant whose code is on two lines and names no `nth` throws. */
	readonly nth?: number;
	readonly operator: string;
	/** The text it changes on its line (the first match), and what to; else the operator's own. */
	readonly from?: string;
	readonly to?: string;
	/** Why no run can tell it from the code as it is (it is never run, and stays out of the kill
	 *  rate): written up once, so a list keeps it without it counting as a survivor. */
	readonly equivalent?: string;
	/** The buggify points its recovery is proved under (`--buggify-aim`): it runs only in a run
	 *  aimed at exactly these, and a run without an aim leaves it out. */
	readonly aim?: string;
}

/** The mutants a run builds and runs, and the ones written up as {@link Mutant.equivalent}. */
export function runnable(mutants: readonly Mutant[]): { run: Mutant[]; equivalent: Mutant[] } {
	return {
		run: mutants.filter((m) => m.equivalent === undefined),
		equivalent: mutants.filter((m) => m.equivalent !== undefined)
	};
}

/** An operator's own change, when a mutant names no text: the first of its pairs found on the line. */
const OPERATORS: Record<string, ReadonlyArray<readonly [string | RegExp, string]>> = {
	equality: [
		['!==', '==='],
		['===', '!==']
	],
	logical: [
		['&&', '||'],
		['||', '&&'],
		['??', '||']
	],
	relational: [
		['>=', '>'],
		['<=', '<'],
		[/(?<![=>-])>(?![=>])/, '>='],
		[/(?<![=<])<(?![=<])/, '<=']
	],
	boolean: [
		[/\btrue\b/, 'false'],
		[/\bfalse\b/, 'true']
	],
	negate: [[/\bif \((.*)\)/, 'if (!($1))']],
	arithmetic: [
		[' + ', ' - '],
		[' - ', ' + ']
	]
};

/** The index of the line in `m.in` holding `m.code` (its `nth` of several). Throws when none does,
 *  or when several do and it names no `nth`. */
function line_of(text: string, lines: readonly string[], m: Mutant): number {
	const functions = functions_of(m.file, text);
	const found: number[] = [];
	let offset = 0;
	for (const [i, l] of lines.entries()) {
		const indent = l.length - l.trimStart().length;
		if (l.trim() === m.code && function_at(functions, offset + indent) === m.in) found.push(i);
		offset += l.length + 1;
	}
	if (found.length === 0) throw new Error(`${name(m)}: no line in ${m.in} holds ${m.code}`);
	if (m.nth === undefined) {
		if (found.length > 1)
			throw new Error(`${name(m)}: ${found.length} lines in ${m.in} hold ${m.code}: name its nth`);
		return found[0];
	}
	const at = found[m.nth];
	if (at === undefined)
		throw new Error(
			`${name(m)}: nth ${m.nth}, but ${found.length} lines in ${m.in} hold ${m.code}`
		);
	return at;
}

/** `text` with `m` applied: its line's first match of its text changed. Throws when it does not
 *  apply, so a mutant that changes nothing is never judged. */
export function apply_mutant(text: string, m: Mutant): string {
	const lines = text.split('\n');
	const at = line_of(text, lines, m);
	const line = lines[at];
	const pairs: ReadonlyArray<readonly [string | RegExp, string]> =
		m.from !== undefined ? [[m.from, m.to ?? '']] : (OPERATORS[m.operator] ?? []);
	for (const [from, to] of pairs) {
		const found = typeof from === 'string' ? line.includes(from) : from.test(line);
		if (!found) continue;
		lines[at] = typeof from === 'string' ? line.replace(from, () => to) : line.replace(from, to);
		return lines.join('\n');
	}
	throw new Error(`${name(m)}: nothing to change on its line in ${m.in}: ${line.trim()}`);
}

/** The package `file` is in (`packages/<name>`): what is built again with it. */
export function package_of(file: string): string {
	const m = /^packages\/([^/]+)\/src\//.exec(file);
	if (m === null) throw new Error(`${file}: not a package's source (packages/<name>/src/...)`);
	return `packages/${m[1]}`;
}

/** Each seed's findings (`<target>:<seed>` to signatures) on the code as it is, and with the mutant:
 *  killed by a finding a seed did not have, a seed that did not finish, or `failed` (a build). */
export function verdict(
	base: ReadonlyMap<string, readonly string[]>,
	now: ReadonlyMap<string, readonly string[]>,
	failed?: string
): { killed: boolean; by: string[] } {
	if (failed !== undefined) return { killed: true, by: [failed] };
	const by: string[] = [];
	for (const [key, before] of base) {
		const after = now.get(key);
		if (after === undefined) {
			by.push(`${key} did not finish`);
			continue;
		}
		for (const s of after) if (!before.includes(s)) by.push(`${key} ${s}`);
	}
	return { killed: by.length > 0, by };
}

/** What of a kill's `by` a second run of its seed finds again (`again(target, seed)`: that seed's
 *  findings on the same build). A finding the second run does not find is noise, not the mutant's
 *  (one timing-bound finding "killed" many mutants alike); a build that failed stands. */
export function confirmed(
	by: readonly string[],
	again: (target: string, seed: number) => readonly string[]
): string[] {
	return by.filter((b) => {
		const m = /^(\S+):(\d+) (.+)$/.exec(b);
		return m === null || again(m[1], Number(m[2])).includes(m[3]);
	});
}

/** The command that clones `from` to `to` copy-on-write (built packages and installed modules
 *  included): APFS's clone on macOS, a reflink where the Linux filesystem has one (else a copy). */
export function clone_command(platform: string, from: string, to: string): string {
	return platform === 'darwin'
		? `cp -cR '${from}' '${to}'`
		: `cp -a --reflink=auto '${from}' '${to}'`;
}

/** A run's last line: what it judged of `total` (a time budget may stop it early), and when. */
export function tally(
	judged: ReadonlyArray<{ killed: boolean }>,
	total: number,
	at: string,
	equivalent = 0
): {
	killed: number;
	judged: number;
	equivalent: number;
	total: number;
	rate: number;
	at: string;
} {
	const killed = judged.filter((j) => j.killed).length;
	const rate = judged.length === 0 ? 0 : Math.round((killed / judged.length) * 1000) / 10;
	return { killed, judged: judged.length, equivalent, total, rate, at };
}

function name(m: Mutant): string {
	return m.id ?? `${m.file} > ${m.in}:${m.operator}`;
}

// ── the runner ──────────────────────────────────────────────────────────────────────────────────

const REPO = resolve(import.meta.dirname, '..', '..', '..');

function arg(flag: string): string | undefined {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
}

/** The buggify points every seed aims at (`--buggify-aim`), passed on to cli.ts. */
const AIM = arg('--buggify-aim');

/** A target: a generated app's seed, or the palaestra, and the seeds it runs past the run's own
 *  range (`extra`). */
export type Target = { name: string; gen: number | null; extra: number[] };

/** The targets `--gens` names (`550+33+36`: gen 550, and seeds 33 and 36 past the range), then the
 *  palaestra when asked. */
export function targets(gens: string, palaestra: boolean): Target[] {
	return [
		...gens
			.split(',')
			.filter(Boolean)
			.map((spec) => {
				const [gen, ...extra] = spec.split('+').map(Number);
				return { name: `gen${gen}`, gen: gen!, extra };
			}),
		...(palaestra ? [{ name: 'palaestra', gen: null, extra: [] }] : [])
	];
}

/** Seeds 1 to `range`, then each of `extra` past it, in order. */
export function seed_list(range: number, extra: readonly number[]): number[] {
	return [...Array.from({ length: range }, (_, i) => i + 1), ...extra.filter((s) => s > range)];
}

/** Runs `cmd` in `cwd`, its output to `log`; whether it succeeded. */
function sh(cwd: string, cmd: string, log: string): boolean {
	appendFileSync(log, `\n$ (${cwd}) ${cmd}\n`);
	const r = spawnSync('/bin/sh', ['-c', `${cmd} >> '${log}' 2>&1`], { cwd, stdio: 'ignore' });
	return r.status === 0;
}

/** Builds `target`'s app in the sandbox (a generated app written from its seed, its peer too). */
function build_app(box: string, t: Target, log: string): boolean {
	const sim = join(box, 'internal', 'sim');
	if (t.gen === null)
		return sh(sim, `nice -n 10 node --no-warnings src/builds.ts --app ../../apps/palaestra`, log);
	if (!sh(sim, `node --no-warnings src/gen.ts --seed ${t.gen}`, log)) return false;
	const plan = JSON.parse(readFileSync(join(box, 'apps/sim-gen/src/lib/gen/plan.json'), 'utf8'));
	if (
		plan.peer &&
		!sh(join(box, 'apps/sim-gen-peer'), 'OGYGIA_RULES=1 nice -n 10 pnpm exec vite build', log)
	)
		return false;
	return sh(sim, `nice -n 10 node --no-warnings src/builds.ts --app ../../apps/sim-gen`, log);
}

/** Runs `seeds` on `target` (built), each unbroken range of them in one run; each seed's finding
 *  signatures, by `<target>:<seed>`. */
function run_seeds(
	box: string,
	t: Target,
	seeds: readonly number[],
	jobs: number,
	log: string
): Map<string, string[]> {
	const sim = join(box, 'internal', 'sim');
	const app = t.gen === null ? '../../apps/palaestra' : '../../apps/sim-gen';
	const results = join(sim, 'results.json');
	const out = new Map<string, string[]>();
	for (let i = 0; i < seeds.length;) {
		const from = seeds[i]!;
		let runs = 1;
		while (seeds[i + runs] === from + runs) runs++;
		i += runs;
		rmSync(results, { force: true });
		sh(
			sim,
			`nice -n 10 node --experimental-vm-modules --no-warnings src/cli.ts --app ${app} --runs ${runs} --from ${from} --steps 30 --jobs ${jobs}${AIM ? ` --buggify-aim ${AIM}` : ''}`,
			log
		);
		if (!existsSync(results)) continue;
		const r = JSON.parse(readFileSync(results, 'utf8')) as {
			findings: Array<{ seed: number; oracle: string; detail: string }>;
			replay_leaks: number[];
		};
		for (let s = from; s < from + runs; s++) out.set(`${t.name}:${s}`, []);
		for (const f of r.findings) out.get(`${t.name}:${f.seed}`)?.push(`${f.oracle} ${signature(f)}`);
		for (const s of r.replay_leaks) out.get(`${t.name}:${s}`)?.push('replay leak');
	}
	return out;
}

/** The failing tests of a vitest JSON report (`<file> > <full name>`; a file that failed to run, by
 *  its file alone), or null when there is no report (the run did not finish). */
export function failing_tests(report: string | null, root: string): string[] | null {
	if (report === null) return null;
	const r = JSON.parse(report) as {
		testResults: Array<{
			name: string;
			status: string;
			assertionResults: Array<{ fullName: string; status: string }>;
		}>;
	};
	const out: string[] = [];
	for (const f of r.testResults) {
		const file = f.name.startsWith(root) ? f.name.slice(root.length + 1) : f.name;
		const failed = f.assertionResults.filter((a) => a.status === 'failed');
		if (f.status === 'failed' && failed.length === 0) out.push(file);
		for (const a of failed) out.push(`${file} > ${a.fullName}`);
	}
	return out.sort();
}

/** The compiler's simulator (`internal/compiler-dst`, `--compiler-dst`): it compiles the package
 *  sources themselves, so a mutant needs no build. Its failing tests, `DST_RUNS` apps each. */
function run_compiler_dst(box: string, runs: number, log: string): string[] | null {
	const dir = join(box, 'internal', 'compiler-dst');
	const report = join(dir, 'mutate-report.json');
	rmSync(report, { force: true });
	sh(
		dir,
		`DST_RUNS=${runs} nice -n 10 npx vitest run --maxWorkers=2 --reporter=json --outputFile=${report}`,
		log
	);
	return failing_tests(existsSync(report) ? readFileSync(report, 'utf8') : null, dir);
}

/** The packages a run's mutants build (each with its dependents): the baseline builds them first,
 *  so it runs on the build a mutant's runs on. A clone carries whatever its tree last built: with
 *  a dependent built from older code, every mutant "killed" by the same finding the rebuild brought
 *  (gen 734, seed 11, all 8 of a list). */
export function baseline_packages(mutants: readonly Mutant[]): string[] {
	return [...new Set(mutants.map((m) => package_of(m.file)))].sort();
}

function build_packages(box: string, pkg: string, log: string): boolean {
	return sh(
		box,
		`nice -n 10 pnpm exec turbo run build --filter=./${pkg}... --output-logs=errors-only`,
		log
	);
}

function main(): void {
	const list = arg('--mutants');
	if (list === undefined)
		throw new Error(
			'--mutants <file.json>: a list of { file, in, code, nth?, operator, from?, to? }'
		);
	const mutants = (JSON.parse(readFileSync(list, 'utf8')) as Mutant[]).filter((m) => m.aim === AIM);
	const run_on = targets(arg('--gens') ?? '191,192,193', process.argv.includes('--palaestra'));
	const seeds = Number(arg('--seeds') ?? 20);
	const jobs = Number(arg('--jobs') ?? 4);
	// (no mutant starts once the budget is spent: the daily job's is about an hour)
	const deadline = Date.now() + Number(arg('--budget-min') ?? Infinity) * 60_000;
	const box = resolve(arg('--sandbox') ?? join(tmpdir(), 'ogygia-mutants'));
	if (box === REPO || box.startsWith(`${REPO}/`))
		throw new Error('the sandbox must be outside the repo');
	const out = resolve(arg('--out') ?? join(`${box}-results.jsonl`));
	const log = resolve(`${box}.log`);
	writeFileSync(log, '');
	// (a copy-on-write clone of the tree as it is: built packages and installed modules included)
	rmSync(box, { recursive: true, force: true });
	mkdirSync(dirname(box), { recursive: true });
	if (!sh(dirname(box), clone_command(process.platform, REPO, box), log))
		throw new Error(`could not clone the repo (${log})`);
	console.log(`sandbox ${box}; log ${log}; results ${out}`);
	if (process.argv.includes('--compiler-dst'))
		return compiler_dst_main(mutants, box, out, log, Number(arg('--dst-runs') ?? 100), deadline);

	// the baseline: each target on the code as it is, built as a mutant's is
	for (const pkg of baseline_packages(mutants))
		if (!build_packages(box, pkg, log)) throw new Error(`could not build ${pkg} (${log})`);
	const base = new Map<string, string[]>();
	for (const t of run_on) {
		if (!build_app(box, t, log)) throw new Error(`${t.name}: the baseline build failed (${log})`);
		for (const [k, v] of run_seeds(box, t, seed_list(seeds, t.extra), jobs, log)) base.set(k, v);
		console.log(
			`baseline ${t.name}: ${[...base].filter(([k, v]) => k.startsWith(`${t.name}:`) && v.length).length} seeds with findings`
		);
	}

	const { run, equivalent } = runnable(mutants);
	for (const m of equivalent) console.log(`EQUIV    ${name(m)}: ${m.equivalent}`);
	const judged: Array<{ killed: boolean }> = [];
	for (const m of run) {
		if (Date.now() > deadline) {
			console.log(`time budget spent: ${judged.length} of ${run.length} mutants judged`);
			break;
		}
		const file = join(box, m.file);
		const original = join(REPO, m.file);
		let text: string;
		try {
			text = apply_mutant(readFileSync(original, 'utf8'), m);
		} catch (error) {
			appendFileSync(out, `${JSON.stringify({ mutant: m, skipped: String(error) })}\n`);
			console.log(`skip ${name(m)}: ${String(error)}`);
			continue;
		}
		const pkg = package_of(m.file);
		writeFileSync(file, text);
		const now = new Map<string, string[]>();
		let failed: string | undefined;
		let v = { killed: false, by: [] as string[] };
		if (!build_packages(box, pkg, log)) failed = 'the package build failed';
		else
			for (const t of run_on) {
				if (!build_app(box, t, log)) {
					failed = `${t.name}: the app build failed`;
					break;
				}
				for (const [k, s] of run_seeds(box, t, seed_list(seeds, t.extra), jobs, log)) now.set(k, s);
				// (judged on the targets run so far: a kill needs no more)
				const so_far = new Map([...base].filter(([k]) => now.has(k) || k.startsWith(`${t.name}:`)));
				v = verdict(so_far, now);
				if (!v.killed) continue;
				// (each finding run once more, on this target's build as it stands: noise is not a kill)
				// (an earlier target's findings were run again with its own build, and were noise)
				const by = confirmed(v.by, (target, seed) =>
					target !== t.name
						? []
						: (run_seeds(box, t, [seed], 1, log).get(`${target}:${seed}`) ?? ['did not finish'])
				);
				for (const b of v.by.filter((b) => !by.includes(b))) console.log(`  noise: ${b}`);
				v = { killed: by.length > 0, by };
				if (v.killed) break;
			}
		if (failed !== undefined) v = verdict(base, now, failed);
		judged.push(v);
		appendFileSync(
			out,
			`${JSON.stringify({ mutant: m, killed: v.killed, by: v.by.slice(0, 10) })}\n`
		);
		console.log(
			`${v.killed ? 'KILLED  ' : 'SURVIVED'} ${name(m)}${v.killed ? `: ${v.by[0]}` : ''}`
		);
		// (the next mutant starts from the code as it is)
		copyFileSync(original, file);
		if (!build_packages(box, pkg, log)) throw new Error(`could not build ${pkg} back (${log})`);
	}
	const t = tally(judged, mutants.length, new Date().toISOString(), equivalent.length);
	console.log(
		`\n${t.killed}/${t.judged} killed (${t.rate}%), ${t.judged} of ${t.total} mutants judged, ${t.equivalent} equivalent`
	);
	appendFileSync(out, `${JSON.stringify(t)}\n`);
}

/** A run on the compiler's simulator: killed by a test that failed on no baseline run, found again
 *  by a second run of the same mutant (the re-run rule), or by a run that did not finish. */
function compiler_dst_main(
	mutants: readonly Mutant[],
	box: string,
	out: string,
	log: string,
	runs: number,
	deadline: number
): void {
	const base = run_compiler_dst(box, runs, log);
	if (base === null) throw new Error(`the compiler simulator's baseline did not finish (${log})`);
	console.log(`baseline compiler-dst: ${base.length} failing tests`);
	const { run, equivalent } = runnable(mutants);
	for (const m of equivalent) console.log(`EQUIV    ${name(m)}: ${m.equivalent}`);
	const judged: Array<{ killed: boolean }> = [];
	for (const m of run) {
		if (Date.now() > deadline) {
			console.log(`time budget spent: ${judged.length} of ${run.length} mutants judged`);
			break;
		}
		const file = join(box, m.file);
		const original = join(REPO, m.file);
		let text: string;
		try {
			text = apply_mutant(readFileSync(original, 'utf8'), m);
		} catch (error) {
			appendFileSync(out, `${JSON.stringify({ mutant: m, skipped: String(error) })}\n`);
			console.log(`skip ${name(m)}: ${String(error)}`);
			continue;
		}
		writeFileSync(file, text);
		const now = run_compiler_dst(box, runs, log);
		const again = now === null ? null : run_compiler_dst(box, runs, log);
		const by =
			now === null || again === null
				? ['compiler-dst did not finish']
				: now.filter((t) => !base.includes(t) && again.includes(t));
		const v = { killed: by.length > 0, by };
		judged.push(v);
		appendFileSync(
			out,
			`${JSON.stringify({ mutant: m, killed: v.killed, by: v.by.slice(0, 10) })}\n`
		);
		console.log(
			`${v.killed ? 'KILLED  ' : 'SURVIVED'} ${name(m)}${v.killed ? `: ${v.by[0]}` : ''}`
		);
		copyFileSync(original, file);
	}
	const t = tally(judged, mutants.length, new Date().toISOString(), equivalent.length);
	console.log(
		`\n${t.killed}/${t.judged} killed (${t.rate}%), ${t.judged} of ${t.total} mutants judged, ${t.equivalent} equivalent`
	);
	appendFileSync(out, `${JSON.stringify(t)}\n`);
}

if (process.argv[1] === import.meta.filename) main();
