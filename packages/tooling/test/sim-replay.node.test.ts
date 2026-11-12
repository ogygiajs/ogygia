// Which of the simulator's plans the real-browser tier plays on an app: a plan of a generated app
// is that app's run only while the app on disk is the one its seed wrote, and an app with a peer
// is not played yet (its peer is a second server).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	eager_waits_for,
	judge_perf,
	unplayable,
	type BrowserPlan,
	type PerfEntry
} from '../src/e2e/sim-replay.ts';

const made: string[] = [];
afterEach(() => {
	for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An app folder named `name`, generated from `gen` (with a peer or not) when it is given. */
function app(name: string, gen?: { seed: number; peer: boolean }): string {
	const root = mkdtempSync(join(tmpdir(), 'sim-replay-'));
	made.push(root);
	const dir = join(root, name);
	mkdirSync(join(dir, 'src', 'lib', 'gen'), { recursive: true });
	if (gen)
		writeFileSync(
			join(dir, 'src', 'lib', 'gen', 'plan.json'),
			JSON.stringify({ seed: gen.seed, pages: [], peer: gen.peer ? { mount: 'router' } : null })
		);
	return dir;
}

const plan = (app: string, gen?: number): BrowserPlan => ({
	app,
	seed: 7,
	gen,
	plan: { actions: [] }
});

describe('the real-browser tier plays a plan on its own app', () => {
	it('plays a plan of a hand-written app on that app, from any checkout', () => {
		const dir = app('palaestra');
		expect(unplayable(plan('/elsewhere/apps/palaestra'), dir)).toBe(null);
	});

	it('skips a plan of another app', () => {
		expect(unplayable(plan('/x/apps/palaestra'), app('sim-gen', { seed: 3, peer: false }))).toMatch(
			/a plan of/
		);
	});

	it('plays a generated app plan only on the app its seed wrote', () => {
		const dir = app('sim-gen', { seed: 55, peer: false });
		expect(unplayable(plan(dir, 55), dir)).toBe(null);
		expect(unplayable(plan(dir, 54), dir)).toMatch(/generated app 54, and the app on disk is 55/);
		expect(unplayable(plan(dir), dir)).toMatch(/generated app \(unknown\)/);
	});

	it('skips a generated app that drew a peer', () => {
		const dir = app('sim-gen', { seed: 56, peer: true });
		expect(unplayable(plan(dir, 56), dir)).toMatch(/peer/);
	});
});

describe('layout shift and long tasks, judged', () => {
	const shift = (url: string, value: number): PerfEntry => ({
		kind: 'shift',
		tab: 0,
		url,
		value,
		regions: ['<ogygia-region render="defer">']
	});
	const task = (source: string, duration: number): PerfEntry => ({
		kind: 'task',
		tab: 0,
		url: 'https://app.test/',
		duration,
		source,
		fn: 'f'
	});
	const ours = (u: string) => u.includes('og-runtime');

	it("fails a document whose regions' shifts add up to the limit, and notes a smaller one", () => {
		const small = judge_perf([shift('https://app.test/a', 0.04)], ours);
		expect(small.failing).toEqual([]);
		expect(small.noted).toHaveLength(1);
		const big = judge_perf(
			[shift('https://app.test/a', 0.06), shift('https://app.test/a', 0.05)],
			ours
		);
		expect(big.failing).toEqual([
			'tab 0 https://app.test/a: regions filling in shifted the layout by 0.1100'
		]);
		// (each document on its own)
		expect(
			judge_perf([shift('https://app.test/a', 0.06), shift('https://app.test/b', 0.05)], ours)
				.failing
		).toEqual([]);
	});

	it("fails a long task in ogygia's code only", () => {
		const r = judge_perf(
			[
				task('https://app.test/_app/immutable/og-runtime-1.js', 80),
				task('https://app.test/app.js', 300)
			],
			ours
		);
		expect(r.failing).toEqual([
			"ogygia's code: tab 0 https://app.test/: a 80 ms task in https://app.test/_app/immutable/og-runtime-1.js (f)"
		]);
		expect(r.noted).toHaveLength(2);
	});
});

describe('an eager press, at the moment of the load the simulator pressed at', () => {
	const with_moves = (moves: string, dom = ''): BrowserPlan => ({
		...plan('/apps/palaestra'),
		plan: { actions: [{ kind: 'eager', tab: 0, path: '/x', nth: 1, after: 60 }] },
		seen: [
			{ after: 'first load', tabs: [], requests: [] },
			{
				after: '1 eager',
				tabs: [{ url: '', dom, moves, heard: [], said: [] }],
				requests: []
			}
		]
	});

	// the differential (palaestra 3 and 5): the simulator loads a page in a few virtual ms, with no
	// CPU time, so its press `after` ms came once the load was at rest, and Chromium's, whose load
	// takes longer, came before it (its critical wait touched, its island woken by the press): each
	// side tested another moment of the load
	it('at rest, when the simulator pressed once its critical wait settled and its islands woke', () => {
		const p = with_moves(
			'wake#1 cold -> armed\ncritical-gate#1 fresh -> settled\nwake#1 armed -> waking\nwake#1 waking -> awake',
			'<ogygia-region data-hydrated="" wake="load">'
		);
		expect(eager_waits_for(p, 0)).toBe('rest');
	});

	it('at once, when the press woke an island in the simulator', () => {
		const p = with_moves(
			'critical-gate#1 fresh -> settled\nwake#1 armed -> waking\nwake#1 waking -> awake',
			'<ogygia-region data-hydrated="" data-og-woke="interaction" wake="load">'
		);
		expect(eager_waits_for(p, 0)).toBe(null);
	});

	it('at once, when the simulator pressed while it waited', () => {
		const p = with_moves('critical-gate#1 fresh -> touched\ncritical-gate#1 touched -> settled');
		expect(eager_waits_for(p, 0)).toBe(null);
	});

	it('at once, in a plan with nothing seen', () => {
		expect(eager_waits_for(plan('/apps/palaestra'), 0)).toBe(null);
	});
});
