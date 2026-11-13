// The robustness block of the tests page: its tiles from a report's `robustness`, and the block as
// Svelte renders it on the server. Run by plain node: `node --test src/lib/tests/robustness.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { robustness_view, type Robustness, type RobustnessView, type Summary } from './data.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

const FULL: Robustness = {
	simulation: {
		steps: { total: 201, reached: 171, covered: 30, dead: 0 },
		failures: { total: 1817, fired: 19, covered: 15, impossible: 0, baseline: 1783, proved: 14 },
		mutants: {
			groups: {
				core: { total: 33, equivalent: 9, judged: 12, killed: 12 },
				federation: { total: 6, equivalent: 3, judged: 2, killed: 1 }
			},
			judgedAt: '2026-11-13T12:19:17.120Z'
		},
		buggifyPoints: 12,
		generators: 33,
		sweepApps: 8
	},
	compilerSimulation: { oracles: 6, runs: 360 },
	fuzzing: { differential: 13, differentialFiles: 6, properties: 74, propertyFiles: 46 },
	speed: { benches: 232, benchFiles: 33, functions: 10606, measured: 3510, exempt: 1515 },
	rules: { runtime: 16, lint: 18, ownLint: 14, invariants: 18, enforcers: 46 },
	comments: { flagged: { core: 3276, router: 24, ogygia: 5 }, enforced: ['router'] },
	browsers: [
		{ suite: 'unit tests', kind: 'unit', engines: ['node'] },
		{
			suite: 'packages/core browser tests',
			kind: 'browser',
			engines: ['chromium', 'firefox-stable']
		},
		{ suite: 'apps/palaestra e2e', kind: 'e2e', engines: ['chromium', 'firefox', 'webkit'] }
	]
};

const tile = (v: RobustnessView, what: string) =>
	v.groups.flatMap((g) => g.tiles).find((t) => t.what.startsWith(what));

test('a report made before robustness was counted has no block', () => {
	assert.equal(robustness_view(undefined, COMMIT), null);
	const published = JSON.parse(
		readFileSync(new URL('../../../static/tests/0.13.1/summary.json', import.meta.url), 'utf8')
	) as Summary;
	assert.equal(robustness_view(published.robustness, published.commit), null);
});

test('each tile counts from the report and links to its file at the report’s commit', () => {
	const v = robustness_view(FULL, COMMIT);
	assert.ok(v);
	assert.deepEqual(
		v.groups.map((g) => g.id),
		['simulation', 'compiler-simulation', 'fuzzing', 'speed', 'rules', 'comments']
	);
	assert.equal(tile(v, 'state machine steps')?.n, '201 of 201');
	assert.equal(tile(v, 'places that can fail')?.n, '34 of 1,817');
	assert.equal(tile(v, 'made-to-fail places')?.n, '14 of 19');
	assert.equal(tile(v, 'planted bugs caught')?.n, '13 of 14');
	assert.match(tile(v, 'planted bugs caught')?.what ?? '', /2026-11-13/);
	assert.equal(tile(v, 'functions with something')?.n, '3,510 of 10,606');
	assert.equal(tile(v, 'packages where a new free comment')?.n, '1 of 3');
	assert.equal(tile(v, 'comments still')?.n, '3,305');
	assert.equal(
		tile(v, 'runtime rules')?.href,
		`https://github.com/ogygiajs/ogygia/blob/${COMMIT}/packages/core/src/rules.ts`
	);
	assert.deepEqual(
		v.comments?.map((c) => c.name),
		['core', 'router', 'ogygia']
	);
	assert.deepEqual(
		v.engines.map((e) => e.id),
		['node', 'chromium', 'firefox', 'webkit', 'firefox-stable']
	);
	assert.deepEqual(v.suites[1].runs, [false, true, false, false, true]);
});

test('parts the report could not count say so instead of showing a zero', () => {
	const v = robustness_view(
		{
			...FULL,
			simulation: {
				...FULL.simulation!,
				mutants: {
					groups: { core: { total: 33, equivalent: 9, judged: null, killed: null } },
					judgedAt: null
				}
			},
			compilerSimulation: null,
			speed: { ...FULL.speed, functions: null, measured: null },
			comments: null
		},
		COMMIT
	);
	assert.ok(v);
	assert.equal(tile(v, 'planted bugs on the daily list')?.n, '24');
	assert.equal(tile(v, 'planted bugs caught'), undefined);
	assert.equal(tile(v, 'functions written up')?.n, '1,515');
	assert.equal(tile(v, 'functions with something'), undefined);
	assert.equal(v.comments, null);
	assert.ok(!v.groups.some((g) => g.id === 'compiler-simulation' || g.id === 'comments'));
});

async function block(): Promise<(props: { view: RobustnessView }) => string> {
	const source = readFileSync(new URL('./Robustness.svelte', import.meta.url), 'utf8');
	const { js } = compile(source, { generate: 'server', filename: 'Robustness.svelte' });
	const code = js.code.replaceAll(
		/from ['"](svelte[^'"]*)['"]/g,
		(_, id: string) => `from '${import.meta.resolve(id)}'`
	);
	const mod = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as {
		default: Component<{ view: RobustnessView }>;
	};
	return (props) => render(mod.default, { props }).body;
}

test('the block renders every tile, its link, and the suites table', async () => {
	const v = robustness_view(FULL, COMMIT);
	assert.ok(v);
	const html = (await block())({ view: v });
	assert.match(html, /Beyond the tests/);
	for (const t of v.groups.flatMap((g) => g.tiles)) {
		assert.ok(html.includes(t.n), `tile ${t.what}: ${t.n}`);
		assert.ok(html.includes(`href="${t.href}"`), `tile ${t.what}: its link`);
	}
	assert.match(html, /Firefox \(release\)/);
	assert.match(html, /apps\/palaestra e2e/);
	assert.match(html, /Comments still to turn into tests, by package/);
});

test('the block renders with the uncounted parts left out', async () => {
	const v = robustness_view({ ...FULL, comments: null, compilerSimulation: null }, COMMIT);
	assert.ok(v);
	const html = (await block())({ view: v });
	assert.doesNotMatch(html, /by package/);
	assert.doesNotMatch(html, /compiler oracles/);
	assert.match(html, /Where each suite runs/);
});
