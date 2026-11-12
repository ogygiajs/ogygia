// PAGE FACTS BELONG TO THEIR PAGE (#269). An answer rendered outside its page (a hole) brings the
// `page.data` keys its islands read, and they wait for the next hydrate to join the page store. A
// navigation that swaps the next page in before any island woke must not hand them to the next
// page: its first hydrate would merge the old page's facts over the new page's `page.data`.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { region_fragment } from './_html.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document, seed_page_once } from '../../src/runtime/seeds.ts';
import { boot_link } from '../../src/runtime/slots.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';
import { TEST_MARK_ATTR } from './_response-mark.ts';

const real_fetch = window.fetch;
const home = location.href;

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.fetch = async () =>
		new Response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>next</title>' +
				`<script type="application/x-runtime-stand-in" data-ogygia-runtime${TEST_MARK_ATTR}></script>` +
				`</head><body><p>next</p><script type="application/ogygia-page" data-og-format="json"${TEST_MARK_ATTR}>` +
				JSON.stringify({
					url: new URL('/page-facts-next', location.href).href,
					data: { who: 'next' }
				}) +
				'</script></body></html>',
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	// (the next page's head brought its runtime stand-in)
	for (const el of document.head.querySelectorAll('script[data-ogygia-runtime]')) el.remove();
});

test('facts a hole brought on one page do not join the next page’s page.data', async () => {
	await boot_link().load_devalue();
	// a hole on the first page answers, before any island woke: its facts wait for a hydrate
	region_fragment(
		'<script type="application/ogygia-page-facts">' +
			stringify({ who: 'first' }) +
			'</script><p>hole</p>'
	);
	// the visitor goes to the next page
	await new SpaRouter().navigate(new URL('/page-facts-next', location.href));
	expect(document.querySelector('p')?.textContent).toBe('next');
	expect((page_state.data as { who?: string }).who).toBe('next');
	// the next page's first island hydrates
	seed_page_once();
	expect((page_state.data as { who?: string }).who).toBe('next');
});
