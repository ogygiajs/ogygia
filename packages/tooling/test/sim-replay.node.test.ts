// Which of the simulator's plans the real-browser tier plays on an app: a plan of a generated app
// is that app's run only while the app on disk is the one its seed wrote, and an app with a peer
// is not played yet (its peer is a second server).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { judge_perf, unplayable, type BrowserPlan, type PerfEntry } from '../src/e2e/sim-replay.ts';

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
