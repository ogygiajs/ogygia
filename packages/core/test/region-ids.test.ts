// Which page ids each region's island resolved while it hydrated (src/runtime/region-ids.ts): the
// ids its capture saw, kept per region element, for the reconciler to dispose with the region.
import { afterEach, expect, test } from 'vitest';
import { resolve_sink, set_resolve_sink } from '../src/ref-sink.ts';
import {
	capture_region_ids,
	record_region_id,
	region_owned_ids
} from '../src/runtime/region-ids.ts';

afterEach(() => set_resolve_sink(null));

/** A region element: only its identity is read. */
const region = () => ({}) as Element;

test('the ids resolved during a capture are the region’s, one entry each', () => {
	const a = region();
	const out = capture_region_ids(a, () => {
		resolve_sink!('page:1');
		resolve_sink!('page:2');
		resolve_sink!('page:1');
		return 'hydrated';
	});
	expect(out).toBe('hydrated');
	expect([...region_owned_ids(a)!]).toEqual(['page:1', 'page:2']);
});

test('each region keeps its own ids, and a region that resolved none has none', () => {
	const a = region();
	const b = region();
	capture_region_ids(a, () => resolve_sink!('page:a'));
	capture_region_ids(b, () => resolve_sink!('page:b'));
	record_region_id(a, 'page:a2');
	expect([...region_owned_ids(a)!]).toEqual(['page:a', 'page:a2']);
	expect([...region_owned_ids(b)!]).toEqual(['page:b']);
	expect(region_owned_ids(region())).toBeUndefined();
});

test('the sink is taken down after the capture, even when the island throws', () => {
	const a = region();
	expect(() =>
		capture_region_ids(a, () => {
			resolve_sink!('page:1');
			throw new Error('boom');
		})
	).toThrow('boom');
	expect(resolve_sink).toBeNull();
	expect([...region_owned_ids(a)!]).toEqual(['page:1']);
});
