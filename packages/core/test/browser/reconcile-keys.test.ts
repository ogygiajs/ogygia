// RECONCILE KEYS (runtime/reconcile.ts `stamp_region_keys`), in a real browser: a key names one
// region. Identical regions share a fingerprint; a shared key let the morph match both to one node,
// so a page left with two of them kept one (#807).
import { expect, test } from 'vitest';
import { stamp_region_keys } from '../../src/runtime/reconcile.ts';

const TWIN = '<ogygia-region entry="./a.js" data-og-fp="0123456789abcdef"></ogygia-region>';

function body(html: string): HTMLElement {
	const b = document.createElement('body');
	b.innerHTML = html;
	return b;
}
const keys = (b: HTMLElement) =>
	[...b.querySelectorAll('ogygia-region')].map((r) => r.getAttribute('data-key'));

test('identical regions get one key each, the same on both documents (#807)', () => {
	const live = body(TWIN + TWIN);
	const next = body(TWIN);
	stamp_region_keys(live);
	stamp_region_keys(next);
	const [first, second] = keys(live);
	expect(first).not.toBe(second);
	// the first copy keeps the bare identity: it is kept across a page with one copy
	expect(keys(next)).toEqual([first]);
});

test('a copy added beside an already keyed one never repeats its key', () => {
	const grown = body(TWIN);
	stamp_region_keys(grown);
	grown.insertAdjacentHTML('afterbegin', TWIN);
	stamp_region_keys(grown);
	expect(new Set(keys(grown)).size).toBe(2);
});
