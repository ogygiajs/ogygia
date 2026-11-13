// A navigation that swaps the body whole (the fallback: a page opted out of the reconcile) keeps the
// objects the NEXT page's seed revived. The seed is read before the swap; releasing the page's ids
// after it must not take the incoming page's with the leaving page's.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { transport_decoders } from '../../src/runtime/app-transport.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';
import { REF_WIRE_KEY, ref_reviver, register_kind, resolve, dispose_ids } from '../../src/ref.ts';
import { mark_live_head, TEST_MARK, TEST_MARK_ATTR } from './_response-mark.ts';

register_kind({
	k: 'test-seed-kept',
	match: (v) => typeof v === 'object' && v !== null && '__sk' in (v as object),
	encode: (v) => ({ d: { n: (v as { n: number }).n } }),
	decode: (r) => ({ __sk: true, n: (r.d as { n: number }).n })
});

const ID = 'seed-kept';
const REF = { k: 'test-seed-kept', i: ID, d: { n: 1 } };
const real_fetch = window.fetch;
const home = location.href;
const decoders = transport_decoders as Record<string, (v: never) => unknown>;
let unmark = () => {};

function serve() {
	// the next page's seed carries a wired object, as an app's transport hook writes it
	const seed = stringify(
		{ data: { shared: { __ref: true } } },
		{ [REF_WIRE_KEY]: (v: unknown) => (v as { __ref?: true })?.__ref && REF }
	);
	window.fetch = async () =>
		new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><script data-ogygia-runtime data-og-mark="${TEST_MARK}" type="application/x-runtime-stand-in"></script><title>next</title></head><body><p data-og-no-reconcile>next</p><script type="application/ogygia-page"${TEST_MARK_ATTR}>${seed}</script></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
}

beforeEach(() => {
	link_boot();
	install_morph();
	unmark = mark_live_head();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	decoders[REF_WIRE_KEY] = ref_reviver(true) as (v: never) => unknown;
});
afterEach(() => {
	window.fetch = real_fetch;
	delete decoders[REF_WIRE_KEY];
	dispose_ids([ID]);
	unmark();
	history.replaceState(null, '', home);
});

test('a whole-body swap keeps the objects the next page seed revived', async () => {
	serve();
	const r = new SpaRouter();
	const handed: string[] = [];
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.href);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	await r.navigate(new URL('/nav-fallback-seed-kept-next', location.href));
	await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
	expect(handed).toEqual([]);
	const shared = (page_state.data as { shared?: object }).shared;
	expect(shared).toBeDefined();
	// an island on the page that decodes the same id reunites with page.data's object
	expect(resolve({ ...REF, d: { n: 2 } }, 'page')).toBe(shared);
});
