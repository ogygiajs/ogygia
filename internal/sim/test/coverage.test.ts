import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	all_steps,
	Coverage,
	new_moves,
	step_key,
	step_of_move,
	universe
} from '../src/coverage.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('coverage', () => {
	it('reads every machine the packages define, a flights by its own name', () => {
		const u = universe(ROOT);
		expect(u.get('hole')?.pkg).toBe('core');
		expect(u.get('import-again')?.steps.fresh).toEqual(['failed', 'loaded']);
		// (a flights' entries: flying, kept, gone, under the flights' name)
		expect(u.get('island file')?.steps.flying).toEqual(['kept', 'gone']);
		expect(all_steps(u).has(step_key('import-again', 'failed', 'stuck'))).toBe(true);
	});

	it("gives a flights only the entry steps its options and its file's calls can take", () => {
		const u = universe(ROOT);
		// (no caller asks it `fresh`: a flight is never replaced, a kept answer never run again)
		expect(u.get('island file')?.steps).toEqual({
			flying: ['kept', 'gone'],
			kept: ['gone'],
			gone: []
		});
		// (`keep: 0`: nothing is kept; its file asks `fresh`: a flight replaced by a forced one)
		expect(u.get('frames')?.steps).toEqual({ flying: ['flying', 'gone'], kept: [], gone: [] });
	});

	it('a fresh ask made only when a peek shows no flight out never replaces a flight', () => {
		const u = universe(ROOT);
		// (peer.ts refreshes a stale document with `fresh` under `!seen.flying`: a kept answer runs
		// again, a flight out is joined)
		expect(u.get('federation peer documents')?.steps).toEqual({
			flying: ['kept', 'gone'],
			kept: ['flying', 'gone'],
			gone: []
		});
	});

	it('a move line is a step, and a stop is none', () => {
		expect(step_of_move('island file#3 flying -> kept')).toBe('island file: flying -> kept');
		expect(step_of_move('hole#1 idle -> stopped')).toBeNull();
	});

	it('reads only the moves a log added since the last read, past the lines it let go', () => {
		expect(new_moves('a#1 x -> y\na#1 y -> z', 0)).toEqual({
			lines: ['a#1 x -> y', 'a#1 y -> z'],
			total: 2
		});
		expect(new_moves('a#1 x -> y\na#1 y -> z', 1).lines).toEqual(['a#1 y -> z']);
		// (the log kept its last 2 of 5: 3 were read, so its last 2 are new)
		const log = `(3 earlier moves let go)
a#1 x -> y
a#1 y -> z`;
		expect(new_moves(log, 3)).toEqual({
			lines: ['a#1 x -> y', 'a#1 y -> z'],
			total: 5
		});
		expect(new_moves('', 4)).toEqual({ lines: [], total: 0 });
	});

	it('lists the recovery steps no run reached: a retry, an offline wait, a failure, a give-up, a keep that ran out', () => {
		const c = new Coverage();
		c.add({ steps: { 'hole: fetching -> retrying': 1, 'hole: idle -> armed': 1 }, points: {} });
		const machines = new Map([
			[
				'hole',
				{
					name: 'hole',
					pkg: 'core',
					steps: {
						idle: ['armed'],
						fetching: ['retrying', 'offline', 'idle'],
						retrying: ['fetching'],
						offline: ['armed'],
						failed: ['armed']
					}
				}
			],
			[
				'island file',
				{ name: 'island file', pkg: 'core', steps: { kept: ['gone'], flying: ['kept'] } }
			]
		]) as unknown as Parameters<Coverage['report']>[0];
		expect(c.unreached_recovery(machines)).toEqual([
			'hole: failed -> armed',
			'hole: fetching -> offline',
			'hole: offline -> armed',
			'hole: retrying -> fetching',
			'island file: kept -> gone'
		]);
	});

	it('counts a step or a fired point new only the first time', () => {
		const c = new Coverage();
		expect(
			c.add({ steps: { 'a: x -> y': 2 }, points: { p: { on: true, asked: 3, fired: 0 } } })
		).toEqual(['a: x -> y']);
		expect(
			c.add({ steps: { 'a: x -> y': 1 }, points: { p: { on: true, asked: 1, fired: 1 } } })
		).toEqual(['buggify p']);
		expect(c.steps.get('a: x -> y')).toBe(3);
	});
});
