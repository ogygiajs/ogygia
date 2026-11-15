import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { dedent } from '../../packages/core/src/contract/dedent.ts';
import {
	browsers_of,
	buggify_points,
	collect,
	comments_enforced,
	compiler_sim,
	count_failures,
	count_mutants,
	count_steps,
	flagged_comments,
	fuzzing_of,
	invariants_of,
	grid_cases,
	grid_ci,
	grid_fuzz,
	grid_projects,
	grid_snapshots,
	lint_rules_of,
	region_branches,
	region_mutants,
	speed_of
} from './robustness.ts';

const STEPS = {
	sweep: { palaestra: { runs: 1, steps: 1 }, gens: [191, 192], runs: 1, steps: 1 },
	reached: ['m: a -> b', 'm: b -> a', 'n: x -> y'],
	covered: [{ step: 'n: y -> x', reason: 'r', test: 't.ts', name: 'n' }],
	dead: [{ step: 'n: y -> z', issue: 1, why: 'w' }]
};

test('steps: each bucket counted, of the machines’ steps', () => {
	assert.deepEqual(count_steps(STEPS, 6), { total: 6, reached: 3, covered: 1, dead: 1 });
});

test('steps: with no inventory the total is the ledger’s buckets', () => {
	assert.equal(count_steps(STEPS, null).total, 5);
});

const SITE = (n: number) => `packages/core/src/a.ts > f > catch:${n}`;
const FAILURES = {
	scope: { packages: ['core'], exclude: [] },
	fired: [
		{ site: SITE(0), point: 'p.one', how: 'h', killed_by: 'mut-live' },
		{ site: SITE(1), point: 'p.one', how: 'h', killed_by: 'mut-equivalent' },
		{ site: SITE(2), fault: 'drop', how: 'h' }
	],
	covered: [{ site: SITE(3), reason: 'r', test: 't.ts', name: 'n' }],
	impossible: [{ site: SITE(4), why: 'w', by: 'b.ts', name: 'B' }],
	equivalent: [{ site: SITE(7), why: 'w' }],
	baseline: [SITE(5), SITE(6)]
};

test('failures: each bucket counted; a fired site is proved only by a live mutant', () => {
	assert.deepEqual(count_failures(FAILURES, new Set(['mut-live']), 9), {
		total: 9,
		fired: 3,
		covered: 1,
		impossible: 1,
		equivalent: 1,
		baseline: 2,
		proved: 1
	});
});

test('failures: with no inventory the total is the ledger’s buckets', () => {
	assert.equal(count_failures(FAILURES, new Set(), null).total, 8);
});

const MUTANTS = [
	{ id: 'c1', file: 'packages/core/src/a.ts', in: 'f', code: 'x', operator: 'o' },
	{ id: 'c2', file: 'packages/core/src/a.ts', in: 'f', code: 'y', operator: 'o' },
	{ id: 'c3', file: 'packages/core/src/b.ts', in: 'g', code: 'z', operator: 'o', equivalent: 'e' },
	{ id: 'f1', file: 'packages/federation/src/a.ts', in: 'f', code: 'x', operator: 'o' },
	{ file: 'packages/compiler/src/a.ts', in: 'h', code: 'w', operator: 'statement' }
];

test('mutants: per package, equivalent ones apart; no run read leaves kills unknown', () => {
	assert.deepEqual(count_mutants(MUTANTS, []), {
		groups: {
			compiler: { total: 1, equivalent: 0, judged: null, killed: null },
			core: { total: 3, equivalent: 1, judged: null, killed: null },
			federation: { total: 1, equivalent: 0, judged: null, killed: null }
		},
		judgedAt: null
	});
});

test('mutants: a run’s lines judge them; killed in any run (the aimed one too) is killed', () => {
	const line = (m: (typeof MUTANTS)[number], killed: boolean) =>
		JSON.stringify({ mutant: m, killed, by: [] });
	const daily = [
		line(MUTANTS[0], true),
		line(MUTANTS[1], false),
		line(MUTANTS[4], true),
		JSON.stringify({ killed: 2, judged: 3, total: 5, rate: 66.7, at: '2026-11-13T03:50:00.000Z' })
	].join('\n');
	const aimed = [
		line(MUTANTS[1], true),
		line({ id: 'gone', file: 'packages/core/src/z.ts', in: 'f', code: 'q', operator: 'o' }, true)
	].join('\n');
	const r = count_mutants(MUTANTS, [daily, aimed]);
	assert.deepEqual(r.groups.core, { total: 3, equivalent: 1, judged: 2, killed: 2 });
	assert.deepEqual(r.groups.compiler, { total: 1, equivalent: 0, judged: 1, killed: 1 });
	assert.deepEqual(r.groups.federation, { total: 1, equivalent: 0, judged: 0, killed: 0 });
	assert.equal(r.judgedAt, '2026-11-13T03:50:00.000Z');
});

test('mutants: one a run skipped (its line was not found) is not judged', () => {
	const skipped = JSON.stringify({ mutant: MUTANTS[3], skipped: 'Error: no line holds x' });
	assert.deepEqual(count_mutants(MUTANTS, [skipped]).groups.federation, {
		total: 1,
		equivalent: 0,
		judged: 0,
		killed: 0
	});
});

test('buggify points: each point once, however many places ask it', () => {
	assert.equal(
		buggify_points([
			'if (RULES && buggify.fires(\'a.lost\')) throw x;\nbuggify.fires("b.late")',
			"buggify.fires('a.lost')"
		]),
		2
	);
});

test('compiler simulation: one oracle per fc.assert, its CI runs summed', () => {
	const a = `await fc.assert(fc.asyncProperty(x, async () => {}), { numRuns: RUNS(60) });
		await fc.assert(fc.asyncProperty(x, async () => {}), { numRuns: RUNS(100) });`;
	const b = 'await fc.assert(fc.property(x, () => {}), { numRuns: 40 });';
	assert.deepEqual(compiler_sim([a, b]), { oracles: 3, runs: 200 });
});

test('fuzzing: html-fuzz properties apart from every fast-check property, test files only', () => {
	const r = fuzzing_of([
		{
			path: 'packages/core/test/head.test.ts',
			text: dedent`
				import { fuzz } from '@ogygia/config/html-fuzz';
				fuzz(a, f);
				fuzz(b, g);
			`
		},
		{
			path: 'packages/core/test/decoders.test.ts',
			text: dedent`
				fc.assert(fc.property(a, f));
				fc.assert(fc.property(b, g));
			`
		},
		{ path: 'internal/compiler-dst/test/x.test.ts', text: 'await fc.assert(p);' },
		{ path: 'internal/html-fuzz/src/index.ts', text: 'fc.assert(fc.property(a, f));' },
		{ path: 'packages/core/test/plain.test.ts', text: 'fuzz(a, f);' }
	]);
	assert.deepEqual(r, { differential: 2, differentialFiles: 1, properties: 3, propertyFiles: 2 });
});

test('speed: bench cases and files, exemptions; the gate’s run when there is one', () => {
	const benches = ["bench('a', () => {});\nbench('b', () => {});", "bench('c', () => {});"];
	const exempt = { exempt: [{ id: 'a', reason: 'r' }] };
	assert.deepEqual(speed_of(benches, exempt, null), {
		benches: 3,
		benchFiles: 2,
		functions: null,
		measured: null,
		exempt: 1
	});
	const gate = { functions: 10, measured: 4, exempted: [{}, {}], old_unmeasured: [], all: [] };
	assert.deepEqual(speed_of(benches, exempt, gate), {
		benches: 3,
		benchFiles: 2,
		functions: 10,
		measured: 4,
		exempt: 2
	});
});

const OXLINT = {
	rules: { 'typescript/no-explicit-any': 'error', 'ogygia/a': 'error', 'ogygia/off': 'off' },
	overrides: [
		{ files: ['packages/*/src/**'], rules: { 'no-eval': 'error', 'ogygia/a': 'error' } },
		{ files: ['packages/x/src/**'], rules: { 'ogygia/b': 'off' } },
		{ files: ['packages/router/src/**'], rules: { 'ogygia/structured-comments': 'error' } }
	]
};

test('lint rules: every rule switched on anywhere in the root config, once', () => {
	assert.deepEqual(lint_rules_of(OXLINT), { lint: 4, ownLint: 2 });
});

test('structured comments: the packages whose src makes it an error', () => {
	const all = ['core', 'machine', 'router'];
	assert.deepEqual(comments_enforced(OXLINT, all), ['router']);
	assert.deepEqual(
		comments_enforced(
			{
				rules: {},
				overrides: [
					{ files: ['packages/*/src/**'], rules: { 'ogygia/structured-comments': 'error' } }
				]
			},
			all
		),
		all
	);
	assert.deepEqual(comments_enforced({ rules: {} }, all), []);
});

test('flagged comments: counted per package src, every package listed', () => {
	assert.deepEqual(
		flagged_comments(
			[
				'packages/core/src/a.ts',
				'packages/core/src/b/c.ts',
				'packages/router/src/x.ts',
				'packages/core/test/t.test.ts'
			],
			['core', 'machine', 'router']
		),
		{ core: 2, machine: 0, router: 1 }
	);
});

test('invariants: each section, and the enforcers its line names', () => {
	const md = dedent`
		# Invariants
		## ONE — first
		**Enforced by:** \`rule_a\`, \`ogygia/b\`
		## TWO — second
		**Enforced by:** \`packages/core/test/x.test.ts > name\`
		## Related docs
		- \`x\`
	`;
	assert.deepEqual(invariants_of(md), { invariants: 2, enforcers: 3 });
});

test('browsers: Node for unit tests, the browser jobs for the listed projects, every engine for e2e', () => {
	const plan = `const ENGINES = ['chromium', 'firefox', 'webkit'] as const;
const BROWSER_JOBS = ['firefox', 'webkit', 'firefox-stable'] as const;
const browser_tasks = dry([
	'run',
	'check',
	'--filter=@ogygia/core',
	'--filter=@ogygia/machine'
]).filter((t) => t.task === 'check');`;
	assert.deepEqual(
		browsers_of(plan, { browser: ['core', 'rewrite'], e2e: ['apps/palaestra', 'packages/router'] }),
		[
			{ suite: 'unit tests', kind: 'unit', engines: ['node'] },
			{
				suite: 'packages/core browser tests',
				kind: 'browser',
				engines: ['chromium', 'firefox', 'webkit', 'firefox-stable']
			},
			{ suite: 'packages/rewrite browser tests', kind: 'browser', engines: ['chromium'] },
			{ suite: 'apps/palaestra e2e', kind: 'e2e', engines: ['chromium', 'firefox', 'webkit'] },
			{ suite: 'packages/router e2e', kind: 'e2e', engines: ['chromium', 'firefox', 'webkit'] }
		]
	);
});

function repo(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'robustness-'));
	for (const [f, body] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, f)), { recursive: true });
		writeFileSync(join(dir, f), body);
	}
	execFileSync('git', ['init', '-q'], { cwd: dir });
	execFileSync('git', ['add', '-A'], { cwd: dir });
	return dir;
}

test('a commit with none of the ledgers still reports, with those parts null', () => {
	const dir = repo({
		'packages/core/package.json': '{"name":"@ogygia/core"}',
		'packages/core/src/a.ts': 'export const a = 1;\n',
		'packages/core/test/a.test.ts': 'fc.assert(fc.property(x, () => {}));\n',
		'.github/scripts/ci-plan.ts': "const ENGINES = ['chromium'] as const;\n"
	});
	const r = collect(dir, { lint: false });
	assert.equal(r.simulation, null);
	assert.equal(r.compilerSimulation, null);
	assert.equal(r.comments, null);
	assert.equal(r.fuzzing.properties, 1);
	assert.equal(r.speed.exempt, 0);
	assert.equal(r.rules.invariants, 0);
	assert.equal(r.region, null);
});

const AXES = {
	KIND_AXES: {
		a: { axes: { x: ['1', '2', '3'], y: ['1', '2'], z: ['no', 'yes'] }, server_only: ['z'] },
		b: { axes: { x: ['1', '2'] } }
	},
	PLACES: [{}, {}, {}, {}],
	CLIENT_PLACES: [{}, {}],
	HYDRATE_PLACES: [{}]
};

test('region grid: each kind’s axes multiplied, times its places and test setups', () => {
	assert.deepEqual(grid_cases(AXES, { server: 2, browser: 3 }), {
		server: (12 + 2) * 4 * 2,
		client: (6 + 2) * 2 * 3,
		hydrate: (6 + 2) * 1 * 3
	});
});

test('region grid: the test setups are the projects the grid script runs', () => {
	const script = `spawnSync('pnpm', ['exec', 'vitest', 'run',
		'--project',
		'node',
		'--project', 'node-no-async',
		'--project',
		'browser',
		'test/region-grid.test.ts'])`;
	assert.deepEqual(grid_projects(script), { server: 2, browser: 1 });
});

test('region grid: the engines and parts every pull request runs it in, from the CI plan', () => {
	const plan = `const REGION_GRID_PARTS = ['1/4', '2/4', '3/4', '4/4'];
const ENGINES = ['chromium', 'firefox', 'webkit'] as const;`;
	assert.deepEqual(grid_ci(plan), { engines: ['chromium', 'firefox', 'webkit'], parts: 4 });
	assert.deepEqual(grid_ci("const ENGINES = ['chromium'] as const;"), {
		engines: ['chromium'],
		parts: 0
	});
});

const HEAD = (cases: number, distinct: number) => dedent`
	# Region server grid · async=on · kind=a · at=page (x)
	# ${cases} cases, ${distinct} distinct outputs; per part: head 3.
	# axes: x=1|2
`;

test('region snapshots: every file counted; distinct outputs summed from the full grid’s headers', () => {
	assert.deepEqual(
		grid_snapshots([
			{ path: 'packages/core/test/__snapshots__/region-grid/server/full/a.txt', head: HEAD(9, 4) },
			{ path: 'packages/core/test/__snapshots__/region-grid/server/fast/a.txt', head: HEAD(3, 2) },
			{
				path: 'packages/core/test/browser/__snapshots__/region-grid/client/full/a.txt',
				head: HEAD(5, 1)
			}
		]),
		{ files: 3, fullFiles: 2, distinct: 5 }
	);
});

test('region snapshots: a file with no count in its header fails the count', () => {
	assert.throws(
		() => grid_snapshots([{ path: 'region-grid/server/full/a.txt', head: '# a title\n' }]),
		/region-grid\/server\/full\/a\.txt/
	);
});

test('region fuzz: a property per test, its runs from RUNS, the nightly runs from dst.yml', () => {
	const server = dedent`
		const RUNS = 2000;
		test('one', () => { fuzz(a, f, { runs: RUNS }); });
		test(
			'two',
			() => { fuzz(b, g, { runs: RUNS }); }
		);
	`;
	const browser = dedent`
		const RUNS = Number(inject('fuzz_runs') || 600);
		test('three', async () => {});
	`;
	const dst = dedent`
		jobs:
		  mutate:
		    env:
		      OGYGIA_FUZZ_RUNS: '5'
		  region-grid:
		    steps:
		      - name: The fuzz at length
		        env:
		          OGYGIA_FUZZ_RUNS: '100000'
	`;
	assert.deepEqual(
		grid_fuzz(
			[
				{ path: 'packages/core/test/region-grid-fuzz.test.ts', text: server },
				{ path: 'packages/core/test/browser/region-grid-fuzz.test.ts', text: browser }
			],
			dst
		),
		{
			serverProperties: 2,
			serverRuns: 2000,
			browserProperties: 1,
			browserRuns: 600,
			nightlyRuns: 100000
		}
	);
	assert.equal(grid_fuzz([], '').nightlyRuns, null);
});

test('region mutants: each verdict counted; one with no test and no reason fails the count', () => {
	assert.deepEqual(
		region_mutants({
			mutants: [
				{ id: 'a', verdict: 'killed', by: 'test/a.test.ts › a' },
				{ id: 'b', verdict: 'killed', why: 'the suite crashes' },
				{ id: 'c', verdict: 'equivalent', why: 'never read' }
			]
		}),
		{ total: 3, killed: 2, equivalent: 1 }
	);
	assert.throws(() => region_mutants({ mutants: [{ id: 'd', verdict: 'killed' }] }), /\bd\b/);
	assert.throws(
		() => region_mutants({ mutants: [{ id: 'e', verdict: 'survived', why: 'w' }] }),
		/\be\b/
	);
});

test('region coverage: Region.svelte’s branches from the coverage summary; none without the file', () => {
	const summary = {
		total: { branches: { total: 9000, covered: 8000, pct: 88.9 } },
		'/w/packages/core/src/Region.svelte': { branches: { total: 737, covered: 726, pct: 98.5 } },
		'/w/packages/core/src/LateIsland.svelte': { branches: { total: 5, covered: 4, pct: 80 } }
	};
	assert.deepEqual(region_branches(summary), { covered: 726, total: 737 });
	assert.equal(region_branches({ total: summary.total }), null);
	assert.equal(region_branches(null), null);
});

const ROOT = join(import.meta.dirname, '..', '..');

test('this repository: the grid’s axes load in plain Node and give the cases its full snapshot files hold', () => {
	const r = collect(ROOT, { lint: false }).region;
	assert.ok(r);
	const dir = join(ROOT, 'packages/core/test/__snapshots__/region-grid/server/full');
	const files = execFileSync('git', ['ls-files', dir], { cwd: ROOT, encoding: 'utf8' })
		.split('\n')
		.filter(Boolean);
	const held = files.reduce((n, f) => {
		const m = /^# (\d+) cases/m.exec(readFileSync(join(ROOT, f), 'utf8').slice(0, 2000));
		return n + Number(m?.[1]);
	}, 0);
	assert.equal(r.grid.server, held);
});

test('this repository: every caught Region mutant names a test file that exists', () => {
	const list = JSON.parse(
		readFileSync(join(ROOT, 'packages/core/test/region-mutants.json'), 'utf8')
	) as { mutants: { id: string; verdict: string; by?: string }[] };
	const missing = list.mutants
		.filter((m) => m.by !== undefined)
		.map((m) => ({ id: m.id, file: m.by?.split(' › ')[0] ?? '' }))
		.filter((m) => !existsSync(join(ROOT, 'packages/core', m.file)));
	assert.deepEqual(missing, []);
	assert.equal(new Set(list.mutants.map((m) => m.id)).size, list.mutants.length);
});
