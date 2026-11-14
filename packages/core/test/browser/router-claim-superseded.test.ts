import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { history_room } from './_history-budget.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { runtime_session } from '../../src/runtime/session.ts';

const real_fetch = window.fetch;
const home = location.href;
const fetched: string[] = [];
const handed: string[] = [];
let r: SpaRouter;

beforeEach(async () => {
	await history_room();
	link_boot();
	install_morph();
	fetched.length = 0;
	handed.length = 0;
	document.body.innerHTML = '<p>first</p>';
	runtime_session.adopt_document_head();
	prepare_spa_document();
	window.fetch = async (input: RequestInfo | URL) => {
		const url = new URL(String(input instanceof Request ? input.url : input), location.href);
		fetched.push(url.pathname);
		return new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"></head><body><p id="page">${url.pathname}</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	};
	r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.pathname);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
});

afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
});

test('two navigations while the navigation chunk loads: the first claim stops at the chunk, and only the last one fetches its page', async () => {
	const first = r.navigate(new URL('/claim-first', location.href));
	const last = r.navigate(new URL('/claim-last', location.href));
	await Promise.all([first, last]);
	await expect.poll(() => r.nav.now.kind, { timeout: 5_000 }).toBe('idle');
	expect(fetched).toEqual(['/claim-last']);
	expect(handed).toEqual([]);
	expect(document.getElementById('page')?.textContent).toBe('/claim-last');
	expect(location.pathname).toBe('/claim-last');
});
