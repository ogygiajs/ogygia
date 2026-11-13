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

/** The ids `region` owns: of these, the ones a page holding it keeps. */
const owned = (r: Element) => {
	const ids = ['page:1', 'page:2', 'page:a', 'page:a2', 'page:b'];
	const released = ids_released(
		ids,
		[],
		{ querySelectorAll: () => [r] } as unknown as ParentNode,
		{}
	);
	return ids.filter((id) => !released.includes(id));
};

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

test('a capture inside a capture is its own, and the outer one goes on after it', () => {
	const a = region();
	const seed = {};
	capture_region_ids(a, () => {
		resolve_sink!('page:a');
		capture_region_ids(seed, () => resolve_sink!('page:1'));
		resolve_sink!('page:a2');
	});
	expect(owned(a)).toEqual(['page:a', 'page:a2']);
	expect(ids_released(['page:1', 'page:a'], [], empty_page, seed)).toEqual(['page:a']);
});

test('a region that left releases what only it owned; the next page keeps its own', () => {
	const gone = region();
	const kept = region();
	const next = {};
	record_region_id(gone, 'page:a');
	record_region_id(gone, 'page:b');
	record_region_id(kept, 'page:b');
	record_region_id(next, 'page:2');
	const page = { querySelectorAll: () => [kept] } as unknown as ParentNode;
	// page:1 nobody owns: the page's own, released with it
	expect(ids_released(['page:1', 'page:2', 'page:a', 'page:b'], [gone], page, next)).toEqual([
		'page:1',
		'page:a'
	]);
});
