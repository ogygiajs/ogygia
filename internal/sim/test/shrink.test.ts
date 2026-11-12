import { describe, expect, it } from 'vitest';
import { ddmin, regression_test } from '../src/shrink.ts';

/** A check that fails while every one of `needed` is in the list. */
const needs =
	(...needed: number[]) =>
	async (candidates: ReadonlyArray<readonly number[]>) =>
		candidates.map((c) => needed.every((n) => c.includes(n)));

describe('shrinking a failing run', () => {
	it('keeps only the actions the failure needs, in their order', async () => {
		const items = Array.from({ length: 30 }, (_, i) => i);
		expect((await ddmin(items, needs(7))).items).toEqual([7]);
		expect((await ddmin(items, needs(3, 21, 29))).items).toEqual([3, 21, 29]);
	});

	it('keeps a list that needs all of itself', async () => {
		expect((await ddmin([1, 2], needs(1, 2))).items).toEqual([1, 2]);
	});

	it('writes a regression test that runs the plan and expects the finding gone', () => {
		const src = regression_test({
			name: 'stuck-abc123',
			app: 'apps/sim-gen',
			gen: 22,
			seed: 5,
			plan: { actions: [{ kind: 'reload', tab: 0 }] },
			oracle: 'stuck',
			signature: 'abc123',
			detail: 'at rest: https://app.test/p1: still hole#1 fetching',
			actions: ['tab 0: reload']
		});
		expect(src).toContain('const SEED = 5;');
		expect(src).toContain('const GEN: number | null = 22;');
		expect(src).toContain('//   1. tab 0: reload');
		expect(src).toContain('signature(b) === "abc123"');
	});
});
