// A navigation that swaps the whole body instead of reconciling tells the devtools why, in the
// words of the reason that held: an author's opt-out is an opt-out, not a shadow region.
// (devtools on for this file: the gate is read off the global at first import)
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { history_room } from './_history-budget.ts';

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const { link_boot } = await import('../../src/runtime/boot-link.ts');
const { install: install_morph } = await import('../../src/runtime/morph.ts');
const { SpaRouter } = await import('../../src/runtime/router.ts');
const { prepare_spa_document } = await import('../../src/runtime/seeds.ts');
const { runtime_session } = await import('../../src/runtime/session.ts');
const { snapshot, clear, configure } = await import('../../src/events/bus.ts');

const real_fetch = window.fetch;
const home = location.href;

beforeEach(async () => {
	await history_room();
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	runtime_session.adopt_document_head();
	prepare_spa_document();
});
afterEach(() => {
	window.fetch = real_fetch;
	vi.restoreAllMocks();
	document.body.removeAttribute('data-og-no-reconcile');
	history.replaceState(null, '', home);
});

test.each([
	['the next page', '', 'data-og-no-reconcile'],
	['the page on screen', 'data-og-no-reconcile', '']
])('an author who opts %s out of the reconcile is reported as opt-out', async (_, live, next) => {
	if (live) document.body.setAttribute(live, '');
	window.fetch = async () =>
		new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"></head><body ${next}><p>next</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	const r = new SpaRouter();
	const handed: string[] = [];
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.pathname);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	configure({ active: true, cap: 4096 });
	clear();
	await r.navigate(new URL('/nav-fallback-optout', location.href));
	await expect.poll(() => r.nav.now.kind, { timeout: 5_000 }).toBe('idle');
	expect(handed).toEqual([]);
	const reasons = snapshot()
		.filter((e) => e.name === 'nav.fallback')
		.map((e) => (e as unknown as { reason: string }).reason);
	expect(reasons).toEqual(['opt-out']);
});
