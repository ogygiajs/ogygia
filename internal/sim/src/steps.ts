/**
 * EVERY MACHINE STEP ACCOUNTED FOR. Each step of each machine the packages define (coverage.ts
 * `universe`) is in exactly one bucket of the ledger, `internal/sim/steps.json`:
 *
 * - `reached`: the standard sweep (the ledger's `sweep`: palaestra seeds and generated apps' seeds,
 *   src/sweep.ts) reaches it;
 * - `dead`: no code takes it, filed for removal (`issue`);
 * - `covered`: the fake browser cannot reach it (`reason`), and a real test does: `test` (a file
 *   from the repo root) holds a test named `name`, which the check finds.
 *
 * A step in no bucket fails, so a new step nothing reaches or tests fails the build.
 *
 *   node src/steps.ts                      the static check (the PR check job): the ledger alone
 *   node src/steps.ts --sweep <results>... against a sweep's results.json files: a `reached` step
 *                                          it no longer reaches, or a `dead` one it reached, fails
 *   node src/steps.ts --sweep ... --write  writes `reached` as the sweep found it
 *
 * test/steps.test.ts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { all_steps, universe } from './coverage.ts';

/** The standard sweep: what runs decide the `reached` bucket. */
export interface Sweep {
	readonly palaestra: { readonly runs: number; readonly steps: number };
	/** Generated apps, by seed (`gen.ts --seed`), each run `runs` seeds of `steps` actions. */
	readonly gens: readonly number[];
	readonly runs: number;
	readonly steps: number;
}

export interface Covered {
	readonly step: string;
	/** Why the fake browser cannot reach it. */
	readonly reason: string;
	/** The real test's file, from the repo root. */
	readonly test: string;
	/** The test's name, as its file spells it. */
	readonly name: string;
}

export interface Dead {
	readonly step: string;
	/** The issue that asks for its removal. */
	readonly issue: number;
	readonly why: string;
}

export interface Ledger {
	readonly sweep: Sweep;
	readonly reached: readonly string[];
	readonly covered: readonly Covered[];
	readonly dead: readonly Dead[];
}

export interface Accounting {
	readonly accounted: number;
	readonly total: number;
	/** Why the check fails, one line each; empty when every step is accounted for. */
	readonly failures: string[];
	/** Steps the sweep reached that the ledger has as covered: to move to `reached`. */
	readonly newly_reached: string[];
}

/**
 * Accounts for `all` (every step) with `ledger`. `read` gives a file's text from the repo root
 * (null when it is not there). With `sweep` (the steps a sweep reached), the `reached` bucket is
 * checked against it.
 */
export function account(
	all: ReadonlySet<string>,
	ledger: Ledger,
	o: { read: (path: string) => string | null; sweep?: ReadonlySet<string> }
): Accounting {
	const failures: string[] = [];
	const buckets = new Map<string, string[]>();
	const put = (step: string, bucket: string) =>
		buckets.set(step, [...(buckets.get(step) ?? []), bucket]);
	for (const s of ledger.reached) put(s, 'reached');
	for (const c of ledger.covered) put(c.step, 'covered');
	for (const d of ledger.dead) put(d.step, 'dead');
	for (const s of all) if (!buckets.has(s)) failures.push(`in no bucket: ${s}`);
	for (const [s, b] of buckets)
		if (b.length > 1) failures.push(`in two buckets: ${s} (${b.join(', ')})`);
	for (const s of buckets.keys())
		if (!all.has(s)) failures.push(`no machine has it (the ledger names it): ${s}`);
	for (const c of ledger.covered) {
		const text = o.read(c.test);
		if (text === null) failures.push(`${c.step}: its test file is not there: ${c.test}`);
		else if (
			!text.includes(`'${c.name}'`) &&
			!text.includes(`"${c.name}"`) &&
			!text.includes(`\`${c.name}\``)
		)
			failures.push(`${c.step}: ${c.test} has no test '${c.name}'`);
	}
	const newly_reached: string[] = [];
	let accounted: number;
	if (o.sweep === undefined) accounted = [...all].filter((s) => buckets.has(s)).length;
	else {
		const sweep = o.sweep;
		for (const s of ledger.reached)
			if (all.has(s) && !sweep.has(s)) failures.push(`the sweep no longer reaches it: ${s}`);
		for (const d of ledger.dead)
			if (sweep.has(d.step)) failures.push(`listed dead, but the sweep reached it: ${d.step}`);
		for (const c of ledger.covered) if (sweep.has(c.step)) newly_reached.push(c.step);
		const other = new Set([
			...ledger.covered.map((c) => c.step),
			...ledger.dead.map((d) => d.step)
		]);
		accounted = [...all].filter((s) => sweep.has(s) || other.has(s)).length;
	}
	return { accounted, total: all.size, failures, newly_reached };
}

// ── the check ───────────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const LEDGER = join(ROOT, 'internal', 'sim', 'steps.json');

export function read_ledger(): Ledger {
	return JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
}

/** The steps a results.json reached (its coverage's `steps_reached`). */
export function reached_in(results: string): string[] {
	const r = JSON.parse(readFileSync(results, 'utf8')) as {
		coverage?: { steps_reached?: string[] };
	};
	return r.coverage?.steps_reached ?? [];
}

function main(): void {
	const all = all_steps(universe(ROOT));
	const ledger = read_ledger();
	const at = process.argv.indexOf('--sweep');
	const sweep =
		at === -1
			? undefined
			: new Set(
					process.argv
						.slice(at + 1)
						.filter((a) => !a.startsWith('--'))
						.flatMap(reached_in)
				);
	const a = account(all, ledger, {
		read: (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null),
		sweep
	});
	if (sweep !== undefined && process.argv.includes('--write')) {
		const reached = [...all].filter((s) => sweep.has(s)).sort();
		const covered = ledger.covered.filter((c) => !sweep.has(c.step));
		writeFileSync(LEDGER, `${JSON.stringify({ ...ledger, reached, covered }, null, '\t')}\n`);
		console.log(`wrote ${LEDGER}: ${reached.length} reached`);
	}
	console.log(
		`steps accounted: ${a.accounted}/${a.total} (${Math.round((a.accounted / a.total) * 1000) / 10}%)`
	);
	for (const s of a.newly_reached) console.log(`  now reached (move it to reached: --write): ${s}`);
	for (const f of a.failures) console.log(`  ${f}`);
	if (a.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === import.meta.filename) main();
