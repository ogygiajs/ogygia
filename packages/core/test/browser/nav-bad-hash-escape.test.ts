// A link whose fragment is not valid percent-encoding (`#%E0`) is still a link. The fragment names
// an element by its raw text then, as the browser reads it, and the navigation ends as any other.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';

const real_fetch = window.fetch;
const home = location.href;

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.fetch = async () =>
		new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>next</title></head><body><p>next</p><h2 id="%E0" tabindex="-1">target</h2></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
});

test('a link whose hash is a bad percent escape ends its navigation: after hooks run, the router is idle', async () => {
	const r = new SpaRouter();
	const after: string[] = [];
	r.afterNavigate((nav) => nav.type !== 'enter' && after.push(nav.to.url.pathname));
	const to = new URL('/nav-bad-hash-next#%E0', location.href);
	await r.navigate(to);
	await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
	expect(after).toEqual(['/nav-bad-hash-next']);
	expect(document.activeElement?.id).toBe('%E0');
});
