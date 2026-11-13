import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import Region from '../src/Region.svelte';
import NestScheduleHost from './_fixtures/NestScheduleHost.svelte';
import { nested_context } from '../src/nested.ts';

const region = Region as unknown as Component<Record<string, unknown>>;

function warnings_of(outer: Record<string, unknown>, inner_idle: boolean): string[] {
	const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	void render(region, {
		props: {
			__mode: 'island',
			__entry: '/islands/host.js',
			__component: NestScheduleHost,
			__props: { idle: inner_idle },
			...outer
		}
	}).body;
	return spy.mock.calls.map((c) => String(c[0]));
}

afterEach(() => vi.restoreAllMocks());

describe('a nested island whose schedule is ignored is said; one its parent keeps is not (#1155)', () => {
	it('a `load` island inside a `load` island wakes when it asked: no warning', () => {
		expect(warnings_of({}, false).filter((w) => w.includes('nested_island_with_parent'))).toEqual(
			[]
		);
	});

	it('an `idle` island inside a `load` island wakes early: warned', () => {
		expect(warnings_of({}, true).some((w) => w.includes('nested_island_with_parent'))).toBe(true);
	});

	it('a `load` island the runtime mounts inside a hydrated `load` island (a sheet opened later): no warning', () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const element = { getAttribute: (name: string) => (name === 'wake' ? 'load' : null) };
		void render(NestScheduleHost as never, {
			props: { idle: false },
			context: nested_context(null, element as unknown as Element)
		}).body;
		expect(
			spy.mock.calls.map((c) => String(c[0])).filter((w) => w.includes('nested_island_with_parent'))
		).toEqual([]);
	});

	it('a `load` island inside a `visible` island wakes late: warned', () => {
		expect(
			warnings_of({ visible: true }, false).some((w) => w.includes('nested_island_with_parent'))
		).toBe(true);
	});
});
