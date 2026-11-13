// A BACK OR FORWARD KEEPS ITS PAGE WHERE THE VISITOR LEFT IT UNTIL THE REGIONS ABOVE HAVE LAID OUT
// (#452). The scroll goes back right after the swap; a region above the saved position that wakes
// later gets its height then, and the browser's scroll anchoring moves the page by it. The hold puts
// it back for as long as such a region has not settled (woken and laid out), however long that
// takes on a slow runner, not for a fixed time. (The anchoring is the browser's own: WebKit has none,
// and there the page never moves.)
import { afterEach, expect, it, vi } from 'vitest';
import { scope } from '@ogygia/machine';
import { hold_scroll, SCROLL_HOLD_MS } from '../../src/runtime/router-nav.ts';

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let root: HTMLElement | null = null;
afterEach(() => {
	root?.remove();
	root = null;
	scrollTo(0, 0);
});

/** A page with a region at the top, still asleep (no height), and a tall body below it. */
function page(): HTMLElement {
	root = document.createElement('div');
	root.innerHTML = `<ogygia-region entry="/never-loaded.js" wake="load"><div data-top style="height: 0; overflow: hidden">top</div></ogygia-region><div style="height: 6000px"></div>`;
	document.body.prepend(root);
	return root.querySelector('ogygia-region')!;
}

/** The region wakes: it lays out 109 px (the browser's anchoring scrolls by it), and says so. */
function wake(region: HTMLElement): void {
	(region.firstElementChild as HTMLElement).style.height = '109px';
	region.setAttribute('data-hydrated', '');
	region.dispatchEvent(new CustomEvent('ogygia:hydrated', { bubbles: true }));
}

it('a region above that wakes after the old 1.5 s window is still held for', async () => {
	const region = page();
	const visit = scope();
	hold_scroll({ x: 0, y: 1200 }, visit);
	expect(scrollY).toBeCloseTo(1200, 0);
	await wait(1700); // a slow runner: the region wakes late
	wake(region);
	await frame();
	await frame();
	expect(scrollY).toBeCloseTo(1200, 0);
	visit.close();
});

it('once the regions above have settled, the page is the visitor’s and the app’s again', async () => {
	const region = page();
	const visit = scope();
	hold_scroll({ x: 0, y: 1200 }, visit);
	wake(region);
	await frame();
	await frame();
	expect(scrollY).toBeCloseTo(1200, 0);
	scrollTo(0, 500); // the app's own scroll, after the page settled
	await frame();
	await frame();
	expect(scrollY).toBeCloseTo(500, 0);
	visit.close();
});

it('with no region above to wait for, the hold ends a frame after the put-back and the browser anchors again', async () => {
	root = document.createElement('div');
	root.innerHTML = `<div style="height: 6000px"></div>`;
	document.body.prepend(root);
	const visit = scope();
	hold_scroll({ x: 0, y: 1200 }, visit);
	expect(document.documentElement.style.overflowAnchor).toBe('none');
	await frame();
	await frame();
	expect(document.documentElement.style.overflowAnchor).toBe('');
	visit.close();
});

it('a region above that never wakes (its code failed) holds the page for SCROLL_HOLD_MS at most', async () => {
	page();
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
	const visit = scope();
	try {
		hold_scroll({ x: 0, y: 1200 }, visit);
		vi.advanceTimersByTime(SCROLL_HOLD_MS - 1);
		expect(document.documentElement.style.overflowAnchor).toBe('none');
		vi.advanceTimersByTime(1);
		expect(document.documentElement.style.overflowAnchor).toBe('');
	} finally {
		vi.useRealTimers();
		visit.close();
	}
});

it('a page still too short to reach the saved position is put there once it grows', async () => {
	const region = page();
	const filler = root!.lastElementChild as HTMLElement;
	filler.style.height = '100px';
	const visit = scope();
	hold_scroll({ x: 0, y: 1200 }, visit);
	expect(scrollY).toBeLessThan(1200);
	filler.style.height = '6000px'; // the rest of the page lays out
	await frame();
	await frame();
	expect(scrollY).toBeCloseTo(1200, 0);
	wake(region);
	visit.close();
});
