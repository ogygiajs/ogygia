// The shape of the test report CI publishes for each release, as static JSON under /tests:
// /tests/index.json, /tests/<version>/summary.json and /tests/<version>/<package file>.json.
// Shared by the server reader (report.server.ts) and the pages.

export type Kind = 'unit' | 'browser' | 'e2e' | 'types' | 'rules';
export type Engine = 'node' | 'chromium' | 'firefox' | 'webkit';
export type Result = 'pass' | 'fail' | 'skip';
export type Coverage = { lines: number; branches: number; functions: number; statements?: number };
export type Tally = { pass: number; fail: number; skip: number };

export type PackageSummary = {
	tests: number;
	byKind: Partial<Record<Kind, number>>;
	coverage: Coverage;
	srcLines: number;
	testLines: number;
	fail: number;
};

/** One group of the daily mutation list (a package's mutants): `killed` and `judged` are null when
 *  the report had no mutation run to read. */
export type MutantGroup = {
	total: number;
	equivalent: number;
	judged: number | null;
	killed: number | null;
};

/** A test suite and the engines CI runs it in. */
export type SuiteEngines = {
	suite: string;
	kind: 'unit' | 'browser' | 'e2e';
	engines: string[];
};

/**
 * How hard ogygia is checked beyond its tests, counted from the repository at the report's commit
 * by the same script. A part is null when that commit has nothing to count it from.
 */
export type Robustness = {
	simulation: {
		/** Every step of every state machine, each reached by the sweep, covered by a named test, or
		 *  dead (internal/sim/steps.json). */
		steps: { total: number; reached: number; covered: number; dead: number } | null;
		/** Every place the source can fail (internal/sim/failures.json). `proved`: fired sites whose
		 *  recovery a mutant the simulator kills proves checked. */
		failures: {
			total: number;
			fired: number;
			covered: number;
			impossible: number;
			/** Sites whose broken handling changes nothing (absent in reports from before the bucket). */
			equivalent?: number;
			baseline: number;
			proved: number;
		} | null;
		/** The daily mutation list (internal/sim/mutants.json), by package. */
		mutants: { groups: Record<string, MutantGroup>; judgedAt: string | null } | null;
		/** The fault switches in package source (`buggify.fires('<point>')`). */
		buggifyPoints: number;
		/** The app shapes the generated apps are drawn from (gen.ts streams). */
		generators: number;
		/** The apps the standard sweep runs: the palaestra and the generated ones. */
		sweepApps: number;
	} | null;
	/** The compiler's simulation (internal/compiler-dst): its oracles and the runs CI gives them. */
	compilerSimulation: { oracles: number; runs: number } | null;
	fuzzing: {
		/** Properties that check a scanner against the spec HTML parser (internal/html-fuzz). */
		differential: number;
		differentialFiles: number;
		/** Every fast-check property (`fc.assert`) in a test file. */
		properties: number;
		propertyFiles: number;
	};
	speed: {
		/** Bench cases Heisenbench counts in steps (packages/<pkg>/bench). */
		benches: number;
		benchFiles: number;
		/** From the measurement-source gate's run: null when the report had none to read. */
		functions: number | null;
		measured: number | null;
		/** Functions written up as needing no measure (internal/heisenbench/unmeasured.json). */
		exempt: number;
	};
	rules: {
		/** Rules registered in package source and checked in dev and every e2e test. */
		runtime: number;
		/** Lint rules switched on in the root .oxlintrc.json; `own` are ogygia's. */
		lint: number;
		ownLint: number;
		/** Sections of INVARIANTS.md, and the enforcers their lines name. */
		invariants: number;
		enforcers: number;
	};
	/** Comments `ogygia/structured-comments` still flags in each package's src, and the packages
	 *  where the rule is an error. Null when the lint could not be run. */
	comments: { flagged: Record<string, number>; enforced: string[] } | null;
	browsers: SuiteEngines[];
};

export type Summary = {
	version: string;
	commit: string;
	date: string;
	/** The browser engines this report ran. */
	engines?: ('chromium' | 'firefox' | 'webkit')[];
	/** False while the end-to-end suites are not part of the report. */
	e2e?: boolean;
	totals: {
		tests: number;
		byKind: Record<Kind, number>;
		byEngine: Record<'chromium' | 'firefox' | 'webkit', Tally>;
		regression: number;
		seeded: number;
		benches: number;
		srcLines: number;
		testLines: number;
		ratio: number;
		/** What `ratio` counts, in the report's words. */
		ratioDefinition?: string;
		coverage: Coverage & { statements: number };
	};
	packages: Record<string, PackageSummary>;
	/** Absent from reports made before it was counted. */
	robustness?: Robustness;
};

/**
 * One test run: `[file index, name, kind, results, issue?]`. `results` has one letter per
 * `where` entry: `p` pass, `f` fail, `s` skip, `-` not run there.
 */
export type TestEntry = [
	file: number,
	name: string,
	kind: Kind,
	results: string,
	issue?: number | string
];

export type PackageReport = {
	format: number;
	where: Engine[];
	files: string[];
	tests: TestEntry[];
	coverage: Coverage;
};

export const KINDS: { id: Kind; label: string }[] = [
	{ id: 'unit', label: 'Unit' },
	{ id: 'browser', label: 'Browser' },
	{ id: 'e2e', label: 'End to end' },
	{ id: 'types', label: 'Type tests' },
	{ id: 'rules', label: 'Lint rules' }
];
export const ENGINES: { id: Engine; label: string }[] = [
	{ id: 'node', label: 'Node' },
	{ id: 'chromium', label: 'Chromium' },
	{ id: 'firefox', label: 'Firefox' },
	{ id: 'webkit', label: 'WebKit' }
];

/** `0.13.0` sorts above `0.12.4`, and a release above its own prereleases. */
export function compare_versions(a: string, b: string): number {
	const [ma, pa = ''] = a.split('-', 2);
	const [mb, pb = ''] = b.split('-', 2);
	const na = ma.split('.').map(Number);
	const nb = mb.split('.').map(Number);
	for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return nb[i] - na[i];
	if (pa === pb) return 0;
	if (!pa) return -1;
	if (!pb) return 1;
	return pb.localeCompare(pa, 'en', { numeric: true });
}

/** The URL segment for a package: `@ogygia/core` is `core`. */
export const slug_of = (name: string) => name.replace(/^@ogygia\//, '');

/** The report file for a package: `@ogygia/core` is `ogygia-core.json`. */
export const file_of = (name: string) => `${name.replace(/^@/, '').replace('/', '-')}.json`;

const RESULT: Record<string, Result | undefined> = { p: 'pass', f: 'fail', s: 'skip' };

/**
 * One row per test: a test that runs in Node and in the browsers is one entry per run in the
 * report, and one row here with a result in each engine.
 */
export type Row = {
	file: string;
	name: string;
	kinds: Kind[];
	results: Partial<Record<Engine, Result>>;
	issue?: number | string;
};

export function rows(report: PackageReport): Row[] {
	if (report.format !== 1) throw new Error(`Unknown test report format: ${report.format}`);
	const out = new Map<string, Row>();
	for (const [file_index, name, kind, letters, issue] of report.tests) {
		const file = report.files[file_index];
		const results: Row['results'] = {};
		for (const [i, where] of report.where.entries()) {
			const r = RESULT[letters[i]];
			if (r) results[where] = r;
		}
		const key = `${file}\0${name}`;
		const row = out.get(key);
		if (!row) {
			out.set(key, { file, name, kinds: [kind], results, issue });
			continue;
		}
		if (!row.kinds.includes(kind)) row.kinds.push(kind);
		Object.assign(row.results, results);
		row.issue ??= issue;
	}
	return [...out.values()];
}

export const percent = (n: number) => `${n.toFixed(1)}%`;
export const count = (n: number) => n.toLocaleString('en-US');

export function issue_href(issue: number | string): string {
	const s = String(issue);
	return /^https?:\/\//.test(s)
		? s
		: `https://github.com/ogygiajs/ogygia/issues/${s.replace(/^#/, '')}`;
}
export const issue_label = (issue: number | string) =>
	/^https?:\/\//.test(String(issue)) ? 'issue' : `#${String(issue).replace(/^#/, '')}`;

/** One number on the robustness block: what it counts, why it matters, and the file that explains
 *  it (at the report's commit). */
export type Tile = { n: string; what: string; why: string; href: string; file: string };
export type TileGroup = { id: string; title: string; tiles: Tile[] };
export type RobustnessView = {
	groups: TileGroup[];
	/** Flagged comments per package, most first; null when the report could not count them. */
	comments: { name: string; flagged: number; enforced: boolean }[] | null;
	commentsHref: string;
	/** The engines any suite runs in, in order, and each suite's mark under each. */
	engines: { id: string; label: string }[];
	suites: { suite: string; kind: SuiteEngines['kind']; runs: boolean[] }[];
	browsersHref: string;
};

export const ENGINE_LABELS: Record<string, string> = {
	node: 'Node',
	chromium: 'Chromium',
	firefox: 'Firefox',
	webkit: 'WebKit',
	'firefox-stable': 'Firefox (release)'
};

const of = (a: number, b: number) => `${count(a)} of ${count(b)}`;

/** The robustness block's tiles, from a report's `robustness` (none: a report made before it). */
export function robustness_view(r: Robustness | undefined, commit: string): RobustnessView | null {
	if (!r) return null;
	const at = (file: string) => ({
		href: `https://github.com/ogygiajs/ogygia/blob/${commit}/${file}`,
		file
	});
	const groups: TileGroup[] = [];

	const sim = r.simulation;
	if (sim) {
		const tiles: Tile[] = [];
		if (sim.steps)
			tiles.push({
				n: of(sim.steps.reached + sim.steps.covered + sim.steps.dead, sim.steps.total),
				what: 'state machine steps accounted for',
				why: `Each part of ogygia that changes state is a state machine (a list of allowed moves). Every move is reached by the simulator (${count(sim.steps.reached)}) or checked by a named test (${count(sim.steps.covered)}).`,
				...at('internal/sim/src/steps.ts')
			});
		if (sim.failures) {
			const f = sim.failures;
			tiles.push({
				n: of(f.fired + f.covered + f.impossible + (f.equivalent ?? 0), f.total),
				what: 'places that can fail, each handled on purpose',
				why: `A place where code can fail is made to fail by the simulator (${count(f.fired)}), checked by a test (${count(f.covered)}), or proved it cannot fail (${count(f.impossible)})${f.equivalent ? `, or shown that breaking it changes nothing (${count(f.equivalent)})` : ''}. The other ${count(f.baseline)} are listed and wait their turn; that list may only shrink.`,
				...at('internal/sim/src/failures.ts')
			});
			tiles.push({
				n: of(f.proved, f.fired),
				what: 'made-to-fail places whose recovery is proved',
				why: 'We break the recovery code on purpose. When the simulator notices the break, we know the recovery is really checked.',
				...at('internal/sim/failures.json')
			});
		}
		if (sim.mutants) {
			const groups = Object.values(sim.mutants.groups);
			const live = groups.reduce((n, g) => n + g.total - g.equivalent, 0);
			const judged = groups.every((g) => g.judged !== null)
				? groups.reduce((n, g) => n + (g.judged ?? 0), 0)
				: null;
			const killed = groups.reduce((n, g) => n + (g.killed ?? 0), 0);
			const split = Object.entries(sim.mutants.groups)
				.map(([name, g]) => `${name} ${g.total}`)
				.join(', ');
			tiles.push({
				n: judged === null ? count(live) : of(killed, judged),
				what:
					judged === null
						? 'planted bugs on the daily list'
						: `planted bugs caught in the last daily run${sim.mutants.judgedAt ? ` (${sim.mutants.judgedAt.slice(0, 10)})` : ''}`,
				why: `A mutant (a small planted bug) is put in the code, one at a time, and the simulator must catch it. By package: ${split}. Mutants that change nothing a run can see are left out.`,
				...at('internal/sim/mutants.json')
			});
		}
		tiles.push({
			n: count(sim.buggifyPoints),
			what: 'fault switches in the source',
			why: 'A buggify point (a built-in fault switch) lets the simulator make a real failure happen, like a lost download. Switches never ship to users.',
			...at('internal/notes/dst.md')
		});
		tiles.push({
			n: count(sim.generators),
			what: 'shapes random test apps are built from',
			why: `The simulator writes whole apps from a seed, mixing these shapes. Each sweep runs ${count(sim.sweepApps)} apps, the same way every time.`,
			...at('internal/sim/src/gen.ts')
		});
		groups.push({ id: 'simulation', title: 'Simulation', tiles });
	}

	if (r.compilerSimulation)
		groups.push({
			id: 'compiler-simulation',
			title: 'Compiler simulation',
			tiles: [
				{
					n: count(r.compilerSimulation.oracles),
					what: 'compiler oracles',
					why: 'An oracle (a rule every answer must follow) judges the compiler. For example: two cold builds of one app must agree, and a dev server must serve what a fresh start would.',
					...at('internal/compiler-dst/package.json')
				},
				{
					n: count(r.compilerSimulation.runs),
					what: 'random apps compiled on every CI run',
					why: 'Each app is drawn at random, then compiled cold and in random orders. A failure prints the smallest app that still breaks.',
					...at('internal/compiler-dst/test')
				}
			]
		});

	groups.push({
		id: 'fuzzing',
		title: 'Fuzzing',
		tiles: [
			{
				n: count(r.fuzzing.differential),
				what: `HTML readers checked against a real parser (${count(r.fuzzing.differentialFiles)} files)`,
				why: 'ogygia reads HTML with small, fast scanners. Fuzzing (feeding in odd, random input) checks each answer against the parser browsers follow.',
				...at('internal/html-fuzz/README.md')
			},
			{
				n: count(r.fuzzing.properties),
				what: `property tests (${count(r.fuzzing.propertyFiles)} files)`,
				why: 'A property test says what must always be true, then tries many random inputs. A failure prints its seed, so it can be replayed exactly.',
				...at('internal/html-fuzz/README.md')
			}
		]
	});

	const s = r.speed;
	groups.push({
		id: 'speed',
		title: 'Speed',
		tiles: [
			{
				n: count(s.benches),
				what: `step-count benches (${count(s.benchFiles)} files)`,
				why: 'Heisenbench counts the exact steps code takes instead of timing it. The count is the same on any machine, so a slowdown cannot hide.',
				...at('internal/heisenbench/README.md')
			},
			s.functions !== null && s.measured !== null
				? {
						n: of(s.measured, s.functions),
						what: 'functions with something that measures them',
						why: `A bench or a replayable test measures each one. ${count(s.exempt)} more are written up as needing no measure, each with its reason. A new function with neither fails its pull request.`,
						...at('internal/heisenbench/src/unmeasured.ts')
					}
				: {
						n: count(s.exempt),
						what: 'functions written up as needing no measure',
						why: 'Each comes with its reason. A new function with no measure and no reason fails its pull request.',
						...at('internal/heisenbench/unmeasured.json')
					}
		]
	});

	const rules = r.rules;
	groups.push({
		id: 'rules',
		title: 'Rules as code',
		tiles: [
			{
				n: count(rules.runtime),
				what: 'runtime rules',
				why: 'A rule like "a region is never mounted twice" is code, not a comment. It runs in dev and at the end of every end-to-end test.',
				...at('packages/core/src/rules.ts')
			},
			{
				n: count(rules.lint),
				what: `lint rules (${count(rules.ownLint)} written for ogygia)`,
				why: 'A lint rule (a check that reads the code) stops a known mistake before the code runs.',
				...at('.oxlintrc.json')
			},
			{
				n: count(rules.invariants),
				what: `invariants, with ${count(rules.enforcers)} enforcers`,
				why: 'An invariant is a promise that must always hold. Each one names the rules and tests that enforce it, and a check makes sure they exist.',
				...at('internal/notes/INVARIANTS.md')
			}
		]
	});

	const comments = r.comments
		? Object.entries(r.comments.flagged)
				.map(([name, flagged]) => ({
					name,
					flagged,
					enforced: r.comments?.enforced.includes(name) ?? false
				}))
				.sort((a, b) => b.flagged - a.flagged || a.name.localeCompare(b.name))
		: null;
	if (comments)
		groups.push({
			id: 'comments',
			title: 'Comments become tests',
			tiles: [
				{
					n: count(comments.reduce((n, c) => n + c.flagged, 0)),
					what: 'comments still to turn into tests',
					why: 'A comment that says "this must never happen" is a wish. Each one is moved into a test, rule or type that fails when it stops being true.',
					...at('internal/checks/comments.ts')
				},
				{
					n: of(comments.filter((c) => c.enforced).length, comments.length),
					what: 'packages where a new free comment fails the build',
					why: 'Once a package is done, the lint rule turns on as an error there, so free comments cannot creep back.',
					...at('.oxlintrc.json')
				}
			]
		});

	const used = new Set(r.browsers.flatMap((b) => b.engines));
	const engines = [
		...Object.keys(ENGINE_LABELS).filter((id) => used.has(id)),
		...[...used].filter((id) => !(id in ENGINE_LABELS))
	].map((id) => ({ id, label: ENGINE_LABELS[id] ?? id }));
	return {
		groups,
		comments,
		commentsHref: at('internal/checks/comments.ts').href,
		engines,
		suites: r.browsers.map((b) => ({
			suite: b.suite,
			kind: b.kind,
			runs: engines.map((e) => b.engines.includes(e.id))
		})),
		browsersHref: at('.github/scripts/ci-plan.ts').href
	};
}
