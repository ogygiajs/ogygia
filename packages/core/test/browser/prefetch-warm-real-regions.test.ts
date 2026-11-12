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
// (a file that loads: a forged warm stays marked as warmed, where a failed one is unmarked)
const forged = (where: string) => `/test/browser/fixtures/entry-identity.ts?forged=${where}`;
const PAGE =
	'<!doctype html><title>next</title>' +
	`<!-- <ogygia-region entry="${forged('comment')}"></ogygia-region> -->` +
	`<script>const s = '<ogygia-region entry="${forged('script')}">';</script>` +
	`<textarea><ogygia-region entry="${forged('textarea')}"></textarea>` +
	`<p title='<ogygia-region entry="${forged('attribute')}">'>text</p>` +
	`<ogygia-region hydrate="(width > 1px)" entry="${REAL}"><p>real</p></ogygia-region>`;

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
