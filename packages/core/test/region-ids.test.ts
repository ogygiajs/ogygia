// Which page ids each region's island resolved while it hydrated (src/runtime/region-ids.ts): the
// ids its capture saw, kept per region element, for the reconciler to dispose with the region.
import { afterEach, expect, test } from 'vitest';
import { resolve_sink, set_resolve_sink } from '../src/ref-sink.ts';
import { capture_region_ids, ids_released, record_region_id } from '../src/runtime/region-ids.ts';

afterEach(() => set_resolve_sink(null));

/** A region element: only its identity is read. */
const region = () => ({}) as Element;

/** A page with no region left on it. */
const empty_page = { querySelectorAll: () => [] } as unknown as ParentNode;

/** The ids `region` owns: what its leaving an empty page releases. */
const owned = (r: Element) => ids_released([r], empty_page);

test('the ids resolved during a capture are the region’s, one entry each', () => {
	const a = region();
	const out = capture_region_ids(a, () => {
		resolve_sink!('page:1');
		resolve_sink!('page:2');
		resolve_sink!('page:1');
		return 'hydrated';
	});
	expect(out).toBe('hydrated');
	expect(owned(a)).toEqual(['page:1', 'page:2']);
});

test('each region keeps its own ids, and a region that resolved none has none', () => {
	const a = region();
	const b = region();
	capture_region_ids(a, () => resolve_sink!('page:a'));
	capture_region_ids(b, () => resolve_sink!('page:b'));
	record_region_id(a, 'page:a2');
	expect(owned(a)).toEqual(['page:a', 'page:a2']);
	expect(owned(b)).toEqual(['page:b']);
	expect(owned(region())).toEqual([]);
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
	expect(owned(a)).toEqual(['page:1']);
});
