// A PREFETCH WARMS ONLY THE PAGE'S REAL REGIONS (runtime/router-nav.ts `warm_modules`, #977). The
// router reads the prefetched page's island entries and imports them ahead of the click. Only a
// real `<ogygia-region>` element names an island: text that looks like one (in a comment, a
// script's or textarea's text, an attribute value) must never make the router import a URL.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { reset_load_scheduler } from '../../src/runtime/load-scheduler.ts';
import { is_warmed_module } from '../../src/runtime/region-endpoint-url.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';

const real_fetch = window.fetch;
const REAL = '/test/browser/fixtures/entry-located.ts?warm=real';
const ISLAND = '/test/browser/fixtures/entry-located.ts?warm=island';
// (a file that loads: a forged warm stays marked as warmed, where a failed one is unmarked)
const forged = (where: string) => `/test/browser/fixtures/entry-identity.ts?forged=${where}`;
const PAGE = `<!doctype html><title>next</title><!-- <ogygia-region entry="${forged('comment')}"></ogygia-region> --><script>const s = '<ogygia-region entry="${forged('script')}">';</script><textarea><ogygia-region entry="${forged('textarea')}"></textarea><p title='<ogygia-region entry="${forged('attribute')}">'>text</p><ogygia-region hydrate="(width > 1px)" entry="${REAL}"><p>real</p></ogygia-region>`;

beforeEach(() => {
	reset_load_scheduler();
	reset_document_painted();
	link_boot();
	window.fetch = async () =>
		new Response(PAGE, {
			status: 200,
			headers: { 'content-type': 'text/html', 'cache-control': 'private, max-age=60' }
		});
});
afterEach(() => {
	window.fetch = real_fetch;
});

test('a prefetch warms the real region’s entry and no entry that only looks like a region', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	await nav.fetch_page(new URL('/prefetch-warm-next', location.href).href, undefined, 'prefetch');
	await expect.poll(() => is_warmed_module(REAL), { timeout: 2_000 }).toBe(true);
	for (const where of ['comment', 'script', 'textarea', 'attribute'])
		expect(is_warmed_module(forged(where)), where).toBe(false);
});

// (#1050: a lake's entry, and a server-only hole's, is the region's identity, never a file: imported,
// it asked the server for `/<id>` twice and ended in chunk_reload_needed)
const NO_CODE = `<!doctype html><title>next</title><ogygia-region entry="${forged('lake')}" wake="none" remount="cache"><p>lake</p></ogygia-region><ogygia-region entry="${forged('hole')}" render="defer" endpoint="/__ogygia__?id=x"><p>fallback</p></ogygia-region><ogygia-region entry="${ISLAND}" wake="load"><p>island</p></ogygia-region>`;

test('a prefetch never warms the entry of a region that runs no code (a lake, a server hole)', async () => {
	window.fetch = async () =>
		new Response(NO_CODE, {
			status: 200,
			headers: { 'content-type': 'text/html', 'cache-control': 'private, max-age=60' }
		});
	const nav = await import('../../src/runtime/router-nav.ts');
	await nav.fetch_page(
		new URL('/prefetch-warm-no-code', location.href).href,
		undefined,
		'prefetch'
	);
	await expect.poll(() => is_warmed_module(ISLAND), { timeout: 2_000 }).toBe(true);
	expect(is_warmed_module(forged('lake')), 'lake').toBe(false);
	expect(is_warmed_module(forged('hole')), 'hole').toBe(false);
});
