// What region.ts states about the values region() makes (#512), against the source.
import { afterEach, describe, expect, test } from 'vitest';
import type { Component } from 'svelte';
import { prebaked_region, region, type RegionSchedule } from '../src/region.ts';
import { PORTABLE_FORM } from '../src/portable-form.ts';

const A = (() => {}) as unknown as Component<{ n: number }>;
const sign = (id: string) => `/__ogygia__?id=${id}`;

/** What the transform rewrites a marked import to; `extra` adds the SSR leg's fields. */
function binding(
	extra: Record<string, unknown> = {},
	as_function = false
): Component<{ n: number }> {
	const fields = { __ogRegion: 'r1', __module: '/m.js', ...extra };
	const b = as_function ? Object.assign(() => {}, fields) : fields;
	return b as unknown as Component<{ n: number }>;
}

describe('which region a binding makes', () => {
	test('a wake binding (a component with the descriptor fields) and its signer makes a dual region', () => {
		const f = region(binding({ __component: A, __sign: sign }, true), { n: 1 });
		expect(f.kind).toBe('dual');
	});

	test('a wake binding with no signer (the client leg) renders inline instead of throwing', () => {
		const b = binding({}, true);
		const f = region(b, { n: 1 });
		expect(f.kind).toBe('inline');
		expect(f).toMatchObject({ component: b });
	});
});

describe('the schedule', () => {
	test('the call’s wake and margin win over the binding’s baked ones', () => {
		const b = binding({ __component: A, __sign: sign, __hydrate: 'idle', __hydrateMargin: '1px' });
		const f = region(b, { n: 1 }, () => ({ wake: 'load', margin: '9px' }));
		expect(f).toMatchObject({ hydrate: 'load', hydrateMargin: '9px' });
	});

	test('the schedule function is handed the props', () => {
		const pick: RegionSchedule<{ n: number }> = (d) => ({ wake: d.n > 1 ? 'load' : 'idle' });
		const f = region(binding({ __component: A, __sign: sign }), { n: 2 }, pick);
		expect(f).toMatchObject({ hydrate: 'load' });
	});
});

describe('awaiting a region', () => {
	const g = globalThis as { document?: unknown };
	afterEach(() => {
		delete g.document;
	});

	test('a pre-baked region settles to its own HTML with no render pass', async () => {
		const f = await prebaked_region(A as unknown as Component<Record<string, never>>, '<p>x</p>');
		expect(f).toMatchObject({ kind: 'inline', html: '<p>x</p>' });
	});

	test('on the client, an inline region settles to a plain copy, not rendered', async () => {
		g.document = {};
		const f = region(A, { n: 1 });
		const settled = await f;
		expect(settled).not.toBe(f);
		expect('html' in settled).toBe(false);
		expect('then' in settled).toBe(false);
	});

	test('a dual region with no server renderer is not awaitable', () => {
		const f = region(binding({ __component: A, __sign: sign }), { n: 1 });
		expect('then' in f).toBe(false);
	});

	test('an awaited dual region is a plain copy carrying its HTML, rendered from portable props', async () => {
		const seen: unknown[] = [];
		const snippet = Object.assign(() => {}, { [PORTABLE_FORM]: { portable: true } });
		const f = region(
			binding({
				__component: A,
				__sign: sign,
				__renderHtml: (props: Record<string, unknown>) => {
					seen.push(props.s);
					return '<b>ok</b>';
				}
			}),
			{ n: 1, s: snippet } as never
		);
		const settled = await f;
		expect(settled).not.toBe(f);
		expect('then' in settled).toBe(false);
		expect(settled).toMatchObject({ html: '<b>ok</b>' });
		expect(seen).toEqual([{ portable: true }]);
	});
});
