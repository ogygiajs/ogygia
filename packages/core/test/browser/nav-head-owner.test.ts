import { afterEach, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { TEST_MARK_ATTR } from './_response-mark.ts';

const real_fetch = window.fetch;
const home = location.href;
const added: Element[] = [];

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.fetch = async () =>
		new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>next</title><script type="application/x-runtime-stand-in" data-ogygia-runtime${TEST_MARK_ATTR}>\x3C/script></head><body><p>next</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	for (const el of document.head.querySelectorAll('script[data-ogygia-runtime]')) el.remove();
	for (const el of added.splice(0)) el.remove();
});

const meta = (name: string): HTMLMetaElement => {
	const el = document.createElement('meta');
	el.name = name;
	document.head.append(el);
	added.push(el);
	return el;
};

test('a navigation replaces the head nodes the page owns, and leaves a node nobody claimed', async () => {
	const page_own = meta('page-own');
	runtime_session.claim_page_head(page_own);
	const injected = meta('injected-by-a-script');

	await new SpaRouter().navigate(new URL('/nav-head-owner-next', location.href));

	expect(document.querySelector('p')?.textContent).toBe('next');
	expect(page_own.isConnected).toBe(false);
	expect(injected.isConnected).toBe(true);
});
