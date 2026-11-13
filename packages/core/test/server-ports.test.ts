// THE SERVER'S PORTS ARE ONE PER PROCESS (src/server-ports.ts): a second copy of a module (dev serves
// one twice; an app can bundle core twice) reads what the handle installed into the first.
import { afterEach, expect, test } from 'vitest';
import * as seed_a from '../src/page-seed-registry.ts';
import * as late_a from '../src/late-region-registry.ts';
import * as ctx_a from '../src/context-registry.ts';
import * as stats_a from '../src/server/request-stats.ts';
import * as tail_a from '../src/server/document-tail.ts';

// (a query makes the module loader evaluate a second, separate copy)
const seed_b = (await import('../src/page-seed-registry.ts?copy' as string)) as typeof seed_a;
const late_b = (await import('../src/late-region-registry.ts?copy' as string)) as typeof late_a;
const ctx_b = (await import('../src/context-registry.ts?copy' as string)) as typeof ctx_a;
const stats_b = (await import('../src/server/request-stats.ts?copy' as string)) as typeof stats_a;
const tail_b = (await import('../src/server/document-tail.ts?copy' as string)) as typeof tail_a;

afterEach(() => {
	seed_a.set_page_recorder(null);
	late_a.set_late_recorder(null);
	ctx_a.set_ctx_recorder(null);
	stats_a.set_request_stats_sink(null);
	tail_a.set_tail_reader(null);
});

test('the copies are separate modules', () => {
	expect(seed_b).not.toBe(seed_a);
});

test('a port installed through one copy is read through the other', () => {
	const pages: string[] = [];
	seed_a.set_page_recorder((_s, _seed, _r, entry) => pages.push(entry));
	seed_b.record_page({}, 'all', null, 'island.svelte');
	expect(pages).toEqual(['island.svelte']);

	late_a.set_late_recorder(() => 'slot-1');
	expect(late_b.register_late_region(Promise.resolve())).toBe('slot-1');

	const keys: string[] = [];
	ctx_a.set_ctx_recorder((key) => keys.push(key));
	ctx_b.record_ctx('theme', 'dark');
	expect(keys).toEqual(['theme']);

	expect(stats_b.request_stats_wanted()).toBe(false);
	stats_a.set_request_stats_sink({
		page() {},
		hole() {},
		batchHole() {},
		wantsBatchHoles: () => false,
		detailed: () => true
	});
	expect(stats_b.request_stats_detailed()).toBe(true);
});

test('a port taken away through one copy is gone from the other', () => {
	const tail = {} as tail_a.DocumentTail;
	tail_b.set_tail_reader(() => tail);
	expect(tail_a.document_tail()).toBe(tail);
	tail_a.set_tail_reader(null);
	expect(tail_b.document_tail()).toBeNull();
});
