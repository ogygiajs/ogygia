// A KEY NAMES ONE REGION (#840). Twin regions (same island, same props, one fingerprint) each get a
// reconcile key of their own, by their order: one key for both made a navigation pair them as one
// (a twin left behind on the next page). e2e: apps/palaestra/e2e/skip-marks-kept.spec.ts.
import { expect, test } from 'vitest';
import { stamp_region_keys } from '../../src/runtime/reconcile.ts';

const TWIN = '<ogygia-region entry="./a.js" data-og-fp="0123456789abcdef"></ogygia-region>';

function body(html: string): HTMLElement {
	const b = document.createElement('body');
	b.innerHTML = html;
	return b;
}

const keys = (x: HTMLElement) =>
	[...x.querySelectorAll('ogygia-region')].map((r) => r.getAttribute('data-key'));

test('twin regions get one key each, by their order, and the next render pairs them one to one', () => {
	const live = body(TWIN + TWIN);
	stamp_region_keys(live);
	const [first, second] = keys(live);
	expect(first).not.toBe(second);
	const next = body(TWIN + TWIN);
	stamp_region_keys(next);
	expect(keys(next)).toEqual([first, second]);
});

test('a twin left alone is the first of its kind again on the next stamp', () => {
	const live = body(TWIN + TWIN);
	stamp_region_keys(live);
	const [first] = keys(live);
	live.querySelector('ogygia-region')!.remove();
	stamp_region_keys(live);
	expect(keys(live)).toEqual([first]);
});

test("a key the page wrote itself stays, and a twin's key steps around it", () => {
	const b = body(TWIN.replace('<ogygia-region', '<ogygia-region data-key="mine"') + TWIN);
	stamp_region_keys(b);
	const [authored, stamped] = keys(b);
	expect(authored).toBe('mine');
	expect(stamped).not.toBe('mine');
});
