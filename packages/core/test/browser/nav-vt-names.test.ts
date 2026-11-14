// A VIEW-TRANSITION NAME ONLY THE NEXT PAGE HAS GOES BACK ON ITS ELEMENT ONCE THE TRANSITION SETTLES
// (#1643). The router folds names with no counterpart on the other page into the page cross-fade
// for the transition, and puts them back after it. The reconcile copies the next page's nodes into
// the live page: the fold has to be on the live copies, or the names stay `none` for good and the
// next same-shell navigation does not animate them.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { scope } from '@ogygia/machine';
import { patch } from '../_patch.ts';

const real_fetch = window.fetch;
let spies = scope();
const home = location.href;

/** What a view transition captured: each element's inline name, by id, before and after the swap. */
type Captured = { before: Map<string, string>; after: Map<string, string> };

const names = () => {
	const out = new Map<string, string>();
	for (const el of document.querySelectorAll<HTMLElement>('[id]'))
		out.set(el.id, el.style.getPropertyValue('view-transition-name'));
	return out;
};

/** A view transition that runs its callback at once and settles when the test says. */
function transition(seen: Captured[]): () => void {
	let settle = () => {};
	const finished = new Promise<void>((resolve) => (settle = resolve));
	patch(
		spies,
		document,
		'startViewTransition',
		() =>
			((update: () => void) => {
				const before = names();
				update();
				seen.push({ before, after: names() });
				return {
					ready: Promise.resolve(),
					finished,
					updateCallbackDone: Promise.resolve(),
					skipTransition() {}
				};
			}) as never
	);
	return () => settle();
}

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML =
		'<a id="both" style="view-transition-name: chip">chip</a><a id="here" style="view-transition-name: row-1">row</a>';
	prepare_spa_document();
	window.fetch = async () =>
		new Response(
			'<!doctype html><html><head><meta name="ogygia-router"></head><body><a id="both" style="view-transition-name: chip">chip</a><h1 id="there" style="view-transition-name: hero">hero</h1></body></html>',
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(() => {
	window.fetch = real_fetch;
	spies.close();
	spies = scope();
	history.replaceState(null, '', home);
});

test('names on one page only fold into the cross-fade for the transition, and come back on the live page after', async () => {
	const seen: Captured[] = [];
	const settle = transition(seen);
	const r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation(() => {
		throw new Error('handed off');
	});
	await r.navigate(new URL('/nav-vt-names', location.href));
	await expect.poll(() => r.nav.now.kind, { timeout: 5_000 }).toBe('idle');
	expect(seen).toHaveLength(1);
	const [{ before, after }] = seen;
	expect(before.get('both')).toBe('chip');
	expect(before.get('here')).toBe('none');
	expect(after.get('both')).toBe('chip');
	expect(after.get('there')).toBe('none');
	settle();
	await expect
		.poll(() => document.getElementById('there')?.style.getPropertyValue('view-transition-name'))
		.toBe('hero');
	expect(document.getElementById('both')?.style.getPropertyValue('view-transition-name')).toBe(
		'chip'
	);
});
