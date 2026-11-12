/**
 * MUTATION TESTING THROUGH THE SIMULATOR. A mutant is one change at one line of a package's source
 * (`{ file, line, operator, from?, to? }`, the file from the repo root). Each is applied, ONE at a
 * time, to a sandbox: a copy-on-write clone of the repo outside it (never the real tree), where its
 * package and the ones that depend on it are built (`turbo run build`), then each target app (a
 * generated app's seed, or the palaestra) is built and a fixed seed set runs (4 workers, `nice`).
 * The mutant is KILLED when a seed finds what it did not find on the code as it is (the baseline,
 * run first in the same sandbox), when a seed does not finish, or when the build fails; else it
 * SURVIVED: the simulator missed it, which names a missing oracle or app shape. test/mutate.test.ts.
 *
 *   node src/mutate.ts --mutants <file.json> [--gens 191,192,193] [--palaestra] [--seeds 20]
 *     [--jobs 4] [--sandbox <dir>] [--out <file.jsonl>] [--budget-min <minutes>]
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

export interface Mutant {
	/** A name for it (the list's own, or `<file>:<line>:<operator>`). */
	readonly id?: string;
	/** From the repo root: `packages/<pkg>/src/...`. */
	readonly file: string;
	/** 1-based. */
	readonly line: number;
	readonly operator: string;
	/** The text it changes on its line (the first match), and what to; else the operator's own. */
	readonly from?: string;
	readonly to?: string;
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

/** `text` with `m` applied: its line's first match of its text changed. Throws when it does not
 *  apply, so a mutant that changes nothing is never judged. */
export function apply_mutant(text: string, m: Mutant): string {
	const lines = text.split('\n');
	const at = m.line - 1;
	const line = lines[at];
	if (line === undefined) throw new Error(`${name(m)}: no line ${m.line}`);
	const pairs: ReadonlyArray<readonly [string | RegExp, string]> =
		m.from !== undefined ? [[m.from, m.to ?? '']] : (OPERATORS[m.operator] ?? []);
	for (const [from, to] of pairs) {
		const found = typeof from === 'string' ? line.includes(from) : from.test(line);
		if (!found) continue;
		lines[at] = typeof from === 'string' ? line.replace(from, () => to) : line.replace(from, to);
		return lines.join('\n');
	}
	throw new Error(`${name(m)}: nothing to change on line ${m.line}: ${line.trim()}`);
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
	at: string
): { killed: number; judged: number; total: number; rate: number; at: string } {
	const killed = judged.filter((j) => j.killed).length;
	const rate = judged.length === 0 ? 0 : Math.round((killed / judged.length) * 1000) / 10;
	return { killed, judged: judged.length, total, rate, at };
}

function name(m: Mutant): string {
	return m.id ?? `${m.file}:${m.line}:${m.operator}`;
}

// ── the runner ──────────────────────────────────────────────────────────────────────────────────

const REPO = resolve(import.meta.dirname, '..', '..', '..');

function arg(flag: string): string | undefined {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
}

/** A target: a generated app's seed, or the palaestra. */
type Target = { name: string; gen: number | null };

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

/** Runs the seed set on `target` (built); each seed's finding signatures, by `<target>:<seed>`. */
function run_seeds(
	box: string,
	t: Target,
	seeds: number,
	jobs: number,
	log: string
): Map<string, string[]> {
	const sim = join(box, 'internal', 'sim');
	const app = t.gen === null ? '../../apps/palaestra' : '../../apps/sim-gen';
	const results = join(sim, 'results.json');
	rmSync(results, { force: true });
	sh(
		sim,
		`nice -n 10 node --experimental-vm-modules --no-warnings src/cli.ts --app ${app} --runs ${seeds} --from 1 --steps 30 --jobs ${jobs}`,
		log
	);
	const out = new Map<string, string[]>();
	if (!existsSync(results)) return out;
	const r = JSON.parse(readFileSync(results, 'utf8')) as {
		findings: Array<{ seed: number; oracle: string; detail: string }>;
		replay_leaks: number[];
	};
	for (let s = 1; s <= seeds; s++) out.set(`${t.name}:${s}`, []);
	for (const f of r.findings) out.get(`${t.name}:${f.seed}`)?.push(`${f.oracle} ${signature(f)}`);
	for (const s of r.replay_leaks) out.get(`${t.name}:${s}`)?.push('replay leak');
	return out;
}

/** The packages a change in `pkg` is built again for: it and every package that depends on it. */
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
		throw new Error('--mutants <file.json>: a list of { file, line, operator, from?, to? }');
	const mutants = JSON.parse(readFileSync(list, 'utf8')) as Mutant[];
	const gens = (arg('--gens') ?? '191,192,193').split(',').filter(Boolean).map(Number);
	const targets: Target[] = [
		...gens.map((g) => ({ name: `gen${g}`, gen: g })),
		...(process.argv.includes('--palaestra') ? [{ name: 'palaestra', gen: null }] : [])
	];
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

	// the baseline: each target on the code as it is
	const base = new Map<string, string[]>();
	for (const t of targets) {
		if (!build_app(box, t, log)) throw new Error(`${t.name}: the baseline build failed (${log})`);
		for (const [k, v] of run_seeds(box, t, seeds, jobs, log)) base.set(k, v);
		console.log(
			`baseline ${t.name}: ${[...base].filter(([k, v]) => k.startsWith(`${t.name}:`) && v.length).length} seeds with findings`
		);
	}

	const judged: Array<{ killed: boolean }> = [];
	for (const m of mutants) {
		if (Date.now() > deadline) {
			console.log(`time budget spent: ${judged.length} of ${mutants.length} mutants judged`);
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
			for (const t of targets) {
				if (!build_app(box, t, log)) {
					failed = `${t.name}: the app build failed`;
					break;
				}
				for (const [k, s] of run_seeds(box, t, seeds, jobs, log)) now.set(k, s);
				// (judged on the targets run so far: a kill needs no more)
				const so_far = new Map([...base].filter(([k]) => now.has(k) || k.startsWith(`${t.name}:`)));
				v = verdict(so_far, now);
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
	const t = tally(judged, mutants.length, new Date().toISOString());
	console.log(
		`\n${t.killed}/${t.judged} killed (${t.rate}%), ${t.judged} of ${t.total} mutants judged`
	);
	appendFileSync(out, `${JSON.stringify(t)}\n`);
}

if (process.argv[1] === import.meta.filename) main();
