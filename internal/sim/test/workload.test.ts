// The workload's shapes: a visitor who leaves a page and comes back a while later (10 to 50 s, under
// the 60 s a left page's hole answers linger in the frame store) is drawn, so a store that lets them
// go early is seen asking again (the frame-store EVICT_TTL mutant survived without it).
import { describe, expect, it } from 'vitest';
import { rng } from '../src/rng.ts';
import { ACTION_KINDS, describe as say, next_action, type Action } from '../src/workload.ts';

describe('the workload', () => {
	it('leaves a page and comes back 10 to 50 s later', () => {
		const r = rng(7);
		const away: Action[] = [];
		for (let i = 0; i < 2000; i++) {
			const a = next_action(r, 1, ['/', '/a']);
			if (a.kind === 'away') away.push(a);
		}
		expect(away.length).toBeGreaterThan(0);
		for (const a of away) {
			if (a.kind !== 'away') continue;
			expect(a.ms).toBeGreaterThanOrEqual(10_000);
			expect(a.ms).toBeLessThanOrEqual(50_000);
		}
		expect(ACTION_KINDS).toContain('away');
		expect(say({ kind: 'away', tab: 0, nth: 3, ms: 20_000 })).toBe(
			'tab 0: follow link #3, come back 20000 ms later'
		);
	});
});
