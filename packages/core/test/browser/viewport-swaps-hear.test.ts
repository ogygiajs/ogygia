// The viewport tracker's edges (runtime/viewport.ts): swaps heard while a swap observer is set up
// again, and a watcher joining while the others hear.
import { afterEach, expect, test, vi } from 'vitest';
import { reset_viewport, watch_viewport } from '../../src/runtime/viewport.ts';

const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));

/** A region with no box of its own, rendering `html`, in the page. */
function boxless(html: string): HTMLElement {
	const el = document.createElement('div');
	el.style.display = 'contents';
	el.innerHTML = html;
	document.body.append(el);
	return el;
}
const FAR = `<p style="position:absolute;top:${innerHeight + 500}px;margin:0">far</p>`;
const NEAR = '<p style="margin:0">near</p>';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	reset_viewport();
	document.body.innerHTML = '';
});

test('a swap that lands as another region’s watch ends is still heard, after that stop returns', async () => {
	const a = boxless(NEAR);
	const b = boxless(FAR);
	const heard_b: boolean[] = [];
	const stop_a = watch_viewport(a, '11px', () => {});
	const stop_b = watch_viewport(b, '11px', (on) => heard_b.push(on));
	await settle();
	expect(heard_b).toEqual([false]);
	b.innerHTML = NEAR;
	stop_a();
	expect(heard_b, 'not inside the stop').toEqual([false]);
	await expect.poll(() => heard_b.at(-1), { timeout: 2_000 }).toBe(true);
	stop_b();
});

test('a watcher that joins while the others hear a change hears it once', async () => {
	const el = document.createElement('div');
	el.style.cssText = `position:absolute;top:${innerHeight + 500}px;width:10px;height:10px`;
	document.body.append(el);
	const late: boolean[] = [];
	let stop_late = () => {};
	const stop = watch_viewport(el, '17px', (on) => {
		if (on) stop_late = watch_viewport(el, '17px', (now) => late.push(now));
	});
	await settle();
	el.style.top = '0px';
	await expect.poll(() => late.length, { timeout: 2_000 }).toBeGreaterThan(0);
	await settle();
	expect(late).toEqual([true]);
	stop_late();
	stop();
});
