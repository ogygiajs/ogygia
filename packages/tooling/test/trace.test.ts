// A failing test's machine moves: Vitest's `trace_on_failure` prints them when the test fails, and
// the e2e `moves(page)` reads them off the page.
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { machine } from '@ogygia/machine';
import { trace_on_failure } from '../src/vitest/trace.ts';
import { moves } from '../src/e2e/index.ts';

const visit = machine<{ idle: {}; loading: {} }>()({
	name: 'visit',
	initial: 'idle',
	steps: { idle: ['loading'], loading: ['idle'] }
});

function test_context(name: string) {
	let failed: (() => void) | undefined;
	return {
		context: { task: { name }, onTestFailed: (h: () => void) => (failed = h) },
		fail: () => failed?.()
	};
}

describe('trace_on_failure', () => {
	it("prints the test's machine moves when it fails, even after its teardown stopped them", () => {
		const printed: string[] = [];
		const { context, fail } = test_context('loads');
		const stop = trace_on_failure(context, (t) => printed.push(t));
		visit.create().go('loading');
		stop();
		visit.create().go('loading');
		fail();
		expect(printed).toEqual(['machine moves in "loads":\nvisit#1 idle -> loading']);
	});

	it('prints nothing for a test that passes', () => {
		const printed: string[] = [];
		const { context } = test_context('passes');
		trace_on_failure(context, (t) => printed.push(t))();
		expect(printed).toEqual([]);
	});

	it('says so when no machine moved', () => {
		const printed: string[] = [];
		const { context, fail } = test_context('still');
		trace_on_failure(context, (t) => printed.push(t))();
		fail();
		expect(printed).toEqual(['no machine moved in "still"']);
	});
});

describe('moves(page)', () => {
	const page = (evaluate: () => Promise<unknown>) => ({ evaluate }) as unknown as Page;

	it("reads the page's moves", async () => {
		expect(await moves(page(async () => 'visit#1 idle -> loading'))).toBe(
			'visit#1 idle -> loading'
		);
	});

	it('is null for a page that keeps none, or one that closed', async () => {
		expect(await moves(page(async () => null))).toBeNull();
		expect(
			await moves(
				page(async () => {
					throw new Error('Target page, context or browser has been closed');
				})
			)
		).toBeNull();
	});
});
