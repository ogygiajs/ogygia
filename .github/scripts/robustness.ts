/**
 * THE ROBUSTNESS COUNT for the tests report (test-report.ts): how hard ogygia is checked beyond its
 * tests, counted from the repository at one commit. Every number comes from a ledger, a list or the
 * source that a gate already holds to account, so the page can never say more than CI enforces:
 *
 *   simulation          internal/sim/steps.json, failures.json, mutants.json; buggify points in
 *                       package source; the app shapes gen.ts draws from
 *   compilerSimulation  internal/compiler-dst's properties and the runs CI gives them
 *   fuzzing             html-fuzz differential properties, and every fast-check property
 *   speed               bench cases, and the measurement-source gate's run when one is given
 *   rules               runtime rules, root lint rules, INVARIANTS.md and its enforcers
 *   comments            what `ogygia/structured-comments` still flags, per package
 *   browsers            the engines CI runs each suite in (.github/scripts/ci-plan.ts)
 *
 * The counters are pure (robustness.test.ts runs them on fixture ledgers); `collect` reads a
 * repository and hands them its files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MutantGroup, Robustness, SuiteEngines } from '../../apps/docs/src/lib/tests/data.ts';
import { disk_repo, read_sections } from '../../internal/checks/invariants.ts';
import { all_steps, universe } from '../../internal/sim/src/coverage.ts';
import { inventory, points_in, shapes_in } from '../../internal/sim/src/failures.ts';
import type { FailureLedger } from '../../internal/sim/src/failures.ts';
import type { Mutant } from '../../internal/sim/src/mutate.ts';
import type { Ledger } from '../../internal/sim/src/steps.ts';

type Simulation = NonNullable<Robustness['simulation']>;

/** The steps ledger's buckets, of `total` (every machine's steps; null: the buckets' sum). */
export function count_steps(ledger: Ledger, total: number | null): Simulation['steps'] {
	const reached = ledger.reached.length;
	const covered = ledger.covered.length;
	const dead = ledger.dead.length;
	return { total: total ?? reached + covered + dead, reached, covered, dead };
}

/** The failure ledger's buckets, of `total` (every site; null: the buckets' sum). A fired site is
 *  proved when the mutant it names is in `live` (mutants.json, not equivalent). */
export function count_failures(
	ledger: Pick<FailureLedger, 'fired' | 'covered' | 'impossible' | 'equivalent' | 'baseline'>,
	live: ReadonlySet<string>,
	total: number | null
): Simulation['failures'] {
	const fired = ledger.fired.length;
	const covered = ledger.covered.length;
	const impossible = ledger.impossible.length;
	const equivalent = ledger.equivalent.length;
	const baseline = ledger.baseline.length;
	const proved = ledger.fired.filter(
		(f) => f.killed_by !== undefined && live.has(f.killed_by)
	).length;
	return {
		total: total ?? fired + covered + impossible + equivalent + baseline,
		fired,
		covered,
		impossible,
		equivalent,
		baseline,
		proved
	};
}

/** A mutant's name, as mutate.ts names one the list leaves unnamed. */
const mutant_key = (m: Mutant) => m.id ?? `${m.file} > ${m.in}:${m.operator}`;
const package_of = (file: string) => /^packages\/([^/]+)\//.exec(file)?.[1] ?? 'other';

/**
 * The mutation list by package. `runs` are mutation runs' `.jsonl` texts (mutate.ts `--out`: one
 * line per mutant, judged or skipped, then the tally): a live mutant judged in any is judged, and
 * killed when any run killed it. With no run, `judged` and `killed` are null.
 */
export function count_mutants(
	list: readonly Mutant[],
	runs: readonly string[]
): NonNullable<Simulation['mutants']> {
	const judged = new Map<string, boolean>();
	let judged_at: string | null = null;
	for (const text of runs)
		for (const line of text.split('\n')) {
			if (!line.trim()) continue;
			const j = JSON.parse(line) as { mutant?: Mutant; killed?: boolean; at?: string };
			if (j.mutant) {
				if (typeof j.killed !== 'boolean') continue;
				const key = mutant_key(j.mutant);
				judged.set(key, (judged.get(key) ?? false) || j.killed);
			} else if (j.at !== undefined && (judged_at === null || j.at > judged_at)) judged_at = j.at;
		}
	const read = runs.length > 0;
	const groups: Record<string, MutantGroup> = {};
	for (const m of list) {
		const g = (groups[package_of(m.file)] ??= {
			total: 0,
			equivalent: 0,
			judged: read ? 0 : null,
			killed: read ? 0 : null
		});
		g.total++;
		if (m.equivalent !== undefined) {
			g.equivalent++;
			continue;
		}
		const verdict = judged.get(mutant_key(m));
		if (verdict === undefined || g.judged === null || g.killed === null) continue;
		g.judged++;
		if (verdict) g.killed++;
	}
	const sorted = Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
	return { groups: sorted, judgedAt: judged_at };
}

/** The distinct buggify points `sources` ask (`buggify.fires('<point>')`). */
export function buggify_points(sources: readonly string[]): number {
	return new Set(sources.flatMap(points_in)).size;
}

/** fast-check's own count when a property names none. */
const FC_DEFAULT_RUNS = 100;
const ASSERT_RE = /\bfc\.assert\(/g;
const NUM_RUNS_RE = /\bnumRuns:\s*(?:RUNS\(\s*)?(\d+)/g;

/** The compiler simulation's oracles (each `fc.assert` in its tests) and the runs CI gives them. */
export function compiler_sim(
	tests: readonly string[]
): NonNullable<Robustness['compilerSimulation']> {
	let oracles = 0;
	let runs = 0;
	for (const text of tests) {
		const asserts = text.match(ASSERT_RE)?.length ?? 0;
		const counted = [...text.matchAll(NUM_RUNS_RE)].map((m) => Number(m[1]));
		oracles += asserts;
		runs +=
			counted.reduce((a, b) => a + b, 0) + Math.max(0, asserts - counted.length) * FC_DEFAULT_RUNS;
	}
	return { oracles, runs };
}

const TEST_FILE_RE = /\.(test|spec)\.ts$/;
const HTML_FUZZ_RE = /['"]@ogygia\/config\/html-fuzz['"]/;
const FUZZ_CALL_RE = /(?<![\w.])fuzz\(/g;

/** The fuzzed parsers' properties (html-fuzz, against parse5) and every fast-check property, in
 *  test files. */
export function fuzzing_of(
	files: readonly { path: string; text: string }[]
): Robustness['fuzzing'] {
	const out = { differential: 0, differentialFiles: 0, properties: 0, propertyFiles: 0 };
	for (const { path, text } of files) {
		if (!TEST_FILE_RE.test(path)) continue;
		if (HTML_FUZZ_RE.test(text)) {
			const n = text.match(FUZZ_CALL_RE)?.length ?? 0;
			out.differential += n;
			if (n) out.differentialFiles++;
		}
		const p = text.match(ASSERT_RE)?.length ?? 0;
		out.properties += p;
		if (p) out.propertyFiles++;
	}
	return out;
}

/** The measurement-source gate's gate.json (internal/heisenbench/src/unmeasured.ts), as far as
 *  the report reads it. */
export interface Gate {
	readonly functions: number;
	readonly measured: number;
	readonly exempted: readonly unknown[];
}

/** Bench cases (`bench(`) in `benches` (one text per bench file), the exemptions, and the gate's
 *  run when there is one (its own exemption count then, for the same commit as its functions). */
export function speed_of(
	benches: readonly string[],
	exempt: { exempt: readonly unknown[] } | null,
	gate: Gate | null
): Robustness['speed'] {
	return {
		benches: benches.reduce((n, t) => n + (t.match(/\bbench\(/g)?.length ?? 0), 0),
		benchFiles: benches.length,
		functions: gate?.functions ?? null,
		measured: gate?.measured ?? null,
		exempt: gate ? gate.exempted.length : (exempt?.exempt.length ?? 0)
	};
}

type Level = string | number | [string | number, ...unknown[]];
/** The root `.oxlintrc.json`, as far as the report reads it. */
export interface OxlintConfig {
	readonly rules?: Readonly<Record<string, Level>>;
	readonly overrides?: readonly {
		readonly files: readonly string[];
		readonly rules?: Readonly<Record<string, Level>>;
	}[];
}
const is_on = (level: Level) => {
	const l = Array.isArray(level) ? level[0] : level;
	return l !== 'off' && l !== 0;
};

/** Every rule the root config switches on, at the root or in an override, counted once. */
export function lint_rules_of(config: OxlintConfig): { lint: number; ownLint: number } {
	const on = new Set<string>();
	for (const rules of [config.rules ?? {}, ...(config.overrides ?? []).map((o) => o.rules ?? {})])
		for (const [name, level] of Object.entries(rules)) if (is_on(level)) on.add(name);
	return { lint: on.size, ownLint: [...on].filter((n) => n.startsWith('ogygia/')).length };
}

const STRUCTURED = 'ogygia/structured-comments';
const is_error = (level: Level | undefined) =>
	level !== undefined && (Array.isArray(level) ? level[0] : level) === 'error';

/** The packages (of `all`) whose src the root config makes `ogygia/structured-comments` an error
 *  in: at the root, or in an override over `packages/<pkg>/src` (or `packages/*\/src`). */
export function comments_enforced(config: OxlintConfig, all: readonly string[]): string[] {
	if (is_error(config.rules?.[STRUCTURED])) return [...all];
	const on = new Set<string>();
	for (const o of config.overrides ?? []) {
		if (!is_error(o.rules?.[STRUCTURED])) continue;
		for (const glob of o.files) {
			const m = /^packages\/([^/]+)\/src(?:\/|$)/.exec(glob);
			if (!m) continue;
			if (m[1] === '*') for (const p of all) on.add(p);
			else on.add(m[1]);
		}
	}
	return all.filter((p) => on.has(p));
}

/** Flagged comments (one file path per diagnostic) per package's src; every package listed. */
export function flagged_comments(
	files: readonly string[],
	all: readonly string[]
): Record<string, number> {
	const out = Object.fromEntries(all.map((p) => [p, 0]));
	for (const f of files) {
		const m = /^packages\/([^/]+)\/src\//.exec(f);
		if (m && m[1] in out) out[m[1]]++;
	}
	return out;
}

/** INVARIANTS.md's sections and the enforcers their `**Enforced by:**` lines name. */
export function invariants_of(markdown: string): { invariants: number; enforcers: number } {
	const sections = read_sections(markdown);
	return {
		invariants: sections.length,
		enforcers: sections.reduce((n, s) => n + (s.items?.length ?? 0), 0)
	};
}

/** The quoted names of `const <name> = [...]` in `text`. */
function list_in(text: string, name: string): string[] {
	const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(text);
	return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
}

/**
 * The engines CI runs each suite in, from the CI plan (ci-plan.ts): unit tests in Node; a browser
 * project in Chromium (the check job), and in the browser jobs too when the plan lists its package;
 * an e2e suite in every engine. `browser` are packages with a browser project, `e2e` the
 * directories with a Playwright suite.
 */
export function browsers_of(
	plan: string,
	suites: { browser: readonly string[]; e2e: readonly string[] }
): SuiteEngines[] {
	const engines = list_in(plan, 'ENGINES');
	const jobs = list_in(plan, 'BROWSER_JOBS');
	const at = plan.indexOf('const browser_tasks');
	const block = at === -1 ? '' : plan.slice(at, plan.indexOf(').filter', at));
	const listed = new Set([...block.matchAll(/--filter=@ogygia\/([\w-]+)/g)].map((m) => m[1]));
	return [
		{ suite: 'unit tests', kind: 'unit', engines: ['node'] },
		...suites.browser.map((p): SuiteEngines => ({
			suite: `packages/${p} browser tests`,
			kind: 'browser',
			engines: ['chromium', ...(listed.has(p) ? jobs.filter((j) => j !== 'chromium') : [])]
		})),
		...suites.e2e.map((dir): SuiteEngines => ({ suite: `${dir} e2e`, kind: 'e2e', engines }))
	];
}

/** What the report reads beside the repository: CI artifacts, when it has them. */
export interface Inputs {
	/** Run oxlint for the flagged comments (false: `comments` is null). */
	readonly lint?: boolean;
	/** Mutation runs' `.jsonl` texts (the dst workflow's `dst-mutation` artifact). */
	readonly mutation?: readonly string[];
	/** The measurement-source gate's gate.json (the heisenbench workflow's artifact). */
	readonly gate?: Gate | null;
}

/** The robustness count of the repository at `root` (its tracked files). */
export function collect(root: string, inputs: Inputs = {}): Robustness {
	const files = execFileSync('git', ['ls-files'], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 1 << 28
	})
		.split('\n')
		.filter(Boolean);
	const has = (f: string) => existsSync(join(root, f));
	const read = (f: string) => readFileSync(join(root, f), 'utf8');
	const json = <T>(f: string): T | null => (has(f) ? (JSON.parse(read(f)) as T) : null);
	const packages = [
		...new Set(files.flatMap((f) => /^packages\/([^/]+)\/src\//.exec(f)?.[1] ?? []))
	].sort();
	const package_source = files.filter(
		(f) => /^packages\/[^/]+\/src\/.*\.ts$/.test(f) && !/\.(d|test)\.ts$/.test(f)
	);
	const live_text = (f: string) => (has(f) ? read(f) : '');

	const steps_ledger = json<Ledger>('internal/sim/steps.json');
	const failure_ledger = json<FailureLedger>('internal/sim/failures.json');
	const mutant_list = json<Mutant[]>('internal/sim/mutants.json');
	const simulation: Robustness['simulation'] =
		steps_ledger || failure_ledger || mutant_list
			? {
					steps: steps_ledger && count_steps(steps_ledger, all_steps(universe(root)).size),
					failures:
						failure_ledger &&
						count_failures(
							failure_ledger,
							new Set(
								(mutant_list ?? []).filter((m) => m.equivalent === undefined).map(mutant_key)
							),
							inventory(root, failure_ledger.scope).length
						),
					mutants: mutant_list && count_mutants(mutant_list, inputs.mutation ?? []),
					buggifyPoints: buggify_points(package_source.map(live_text)),
					generators: has('internal/sim/src/gen.ts')
						? new Set(shapes_in(read('internal/sim/src/gen.ts'))).size
						: 0,
					sweepApps: steps_ledger ? 1 + steps_ledger.sweep.gens.length : 0
				}
			: null;

	const dst_tests = files.filter(
		(f) => f.startsWith('internal/compiler-dst/test/') && TEST_FILE_RE.test(f)
	);
	const compiler = dst_tests.length ? compiler_sim(dst_tests.map(read)) : null;

	const test_files = files.filter(
		(f) => TEST_FILE_RE.test(f) && !/(^|\/)(node_modules|fixtures?)\//.test(f)
	);
	const fuzzing = fuzzing_of(test_files.map((path) => ({ path, text: read(path) })));

	const speed = speed_of(
		files.filter((f) => /^packages\/[^/]+\/bench\/[^/]+\.bench\.ts$/.test(f)).map(read),
		json<{ exempt: unknown[] }>('internal/heisenbench/unmeasured.json'),
		inputs.gate ?? null
	);

	const oxlint = json<OxlintConfig>('.oxlintrc.json') ?? {};
	const invariants = has('internal/notes/INVARIANTS.md')
		? invariants_of(read('internal/notes/INVARIANTS.md'))
		: { invariants: 0, enforcers: 0 };
	const rules: Robustness['rules'] = {
		runtime: has('packages') ? disk_repo(root).rule_codes().size : 0,
		...lint_rules_of(oxlint),
		...invariants
	};

	let comments: Robustness['comments'] = null;
	const comments_config = 'internal/lint/comments.oxlintrc.json';
	if (inputs.lint !== false && has(comments_config)) {
		const flagged = lint_diagnostics(root, comments_config);
		comments = {
			flagged: flagged_comments(flagged, packages),
			enforced: comments_enforced(oxlint, packages)
		};
	}

	const vitest_browser = files
		.flatMap((f) => /^packages\/([^/]+)\/vitest\.config\.ts$/.exec(f)?.[1] ?? [])
		.filter((p) => read(`packages/${p}/vitest.config.ts`).includes('browser_runs'));
	const e2e = files
		.flatMap((f) => /^((?:packages|apps)\/[^/]+)\/playwright\.config\.ts$/.exec(f)?.[1] ?? [])
		.filter((dir) => {
			const pkg = json<{ scripts?: Record<string, string> }>(`${dir}/package.json`);
			return pkg?.scripts?.e2e?.includes('playwright') ?? false;
		});
	const browsers = browsers_of(live_text('.github/scripts/ci-plan.ts'), {
		browser: vitest_browser.sort(),
		e2e: e2e.sort()
	});

	return {
		simulation,
		compilerSimulation: compiler,
		fuzzing,
		speed,
		rules,
		comments,
		browsers
	};
}

/** The files of each `ogygia/structured-comments` report under packages/ (one per report), from
 *  the repo root. oxlint exits 1 when it reports anything: its JSON is read either way. */
function lint_diagnostics(root: string, config: string): string[] {
	const bin = join(root, 'node_modules/.bin/oxlint');
	const args = ['-c', config, '-f', 'json', 'packages'];
	let out: string;
	try {
		out = execFileSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
	} catch (e) {
		const said = (e as { stdout?: string }).stdout;
		if (!said) throw e;
		out = said;
	}
	const { diagnostics } = JSON.parse(out) as {
		diagnostics: { filename: string; code?: string }[];
	};
	return diagnostics
		.filter((d) => d.code?.includes('structured-comments') ?? true)
		.map((d) => d.filename.replace(`${root}/`, ''));
}
