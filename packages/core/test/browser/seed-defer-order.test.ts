// A streamed page.data value whose resolve script ran before the runtime: the seed's parse installs
// the live resolver first, so the queued value settles the promise the seed revives.
// Its own file: the defer registry is the document's, shared by a file's tests.
import { expect, test } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { prepare_spa_document, seed_page_once } from '../../src/runtime/seeds.ts';
import { boot_link } from '../../src/runtime/slots.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';
import { DeferRef, defer_reducer } from '../../src/server/page-stream.ts';
import { PAGE_DEFER_BOOTSTRAP, PAGE_DEFER_GLOBAL } from '../../src/page-defer.ts';
import { mark_live_head, TEST_MARK } from './_response-mark.ts';

test('a streamed value that arrived before the runtime settles the promise its seed revives', async () => {
	link_boot();
	await boot_link().load_devalue();
	prepare_spa_document();
	// oxlint-disable-next-line no-eval -- the bootstrap is an inline script's text: run it as the browser does
	(0, eval)(PAGE_DEFER_BOOTSTRAP);
	(globalThis as unknown as Record<string, (i: number, o: boolean, e: string) => void>)[
		PAGE_DEFER_GLOBAL
	](41, true, stringify('early'));
	const unmark = mark_live_head();
	const seed = document.createElement('script');
	seed.type = 'application/ogygia-page';
	seed.setAttribute('data-og-mark', TEST_MARK);
	seed.textContent = stringify({ data: { late: new DeferRef(41) } }, defer_reducer);
	document.body.append(seed);
	try {
		seed_page_once();
		const value = (page_state.data as { late?: Promise<unknown> }).late;
		expect(value).toBeInstanceOf(Promise);
		const settled = await Promise.race([
			value,
			new Promise((done) => setTimeout(() => done('still pending'), 100))
		]);
		expect(settled).toBe('early');
	} finally {
		unmark();
		seed.remove();
	}
});
