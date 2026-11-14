import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
	lint_rules_of,
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
});
