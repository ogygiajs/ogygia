// THE DIFFERENTIAL (src/differ.ts) found it: happy-dom's IntersectionObserver is a stub, so in the
// simulator no `wake: 'visible'` island ever woke by being seen, and the hydration drain waited for a
// viewport snapshot on every turn (`hydrate-drain idle -> waiting`, every look of every run; never in
// Chromium, Firefox or WebKit). A simulated document has a layout of its own (block flow on a
// 1280x720 viewport, src/layout.ts) and an IntersectionObserver that reports from it, at a frame.
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Loop } from '../src/loop.ts';
import { rng } from '../src/rng.ts';
import { boxes, install_layout } from '../src/layout.ts';

type Entry = { target: Element; isIntersecting: boolean; boundingClientRect: { height: number } };
type IO = new (
	cb: (entries: Entry[]) => void,
	options?: { rootMargin?: string }
) => { observe(el: Element): void; unobserve(el: Element): void; disconnect(): void };

function page(body: string) {
	const loop = new Loop(rng(1));
	const w = new Window({ url: 'https://app.test/' });
	install_layout(w as never, loop, 'tab-1#1');
	w.document.write(`<html><head></head><body>${body}</body></html>`);
	const IO = (w as unknown as { IntersectionObserver: IO }).IntersectionObserver;
	const seen: string[] = [];
	const io = new IO((entries) => {
		for (const e of entries) seen.push(`${loop.now} ${e.target.id} ${e.isIntersecting}`);
	});
	const $ = (id: string) => w.document.getElementById(id) as unknown as Element;
	return { loop, w, IO, io, seen, $ };
}

describe('a simulated document has a layout, and its IntersectionObserver reports from it', () => {
	it('reports each target it observes at the next frame: one at the top is on screen, one below the fold is not', async () => {
		const { loop, io, seen, $ } = page(
			'<p id="top">top</p><div style="height: 2000px"></div><p id="below">below</p>'
		);
		io.observe($('top'));
		io.observe($('below'));
		expect(seen).toEqual([]);
		await loop.run(100);
		expect(seen).toEqual(['16 top true', '16 below false']);
	});

	it('reports again when the document changes what is on screen, and not when it does not', async () => {
		const { loop, w, io, seen, $ } = page(
			'<p id="top">top</p><div id="tall" style="height: 2000px"></div><p id="below">below</p>'
		);
		io.observe($('top'));
		io.observe($('below'));
		await loop.run(100);
		seen.length = 0;
		w.document.body.appendChild(w.document.createElement('p'));
		await loop.run(100);
		expect(seen).toEqual([]);
		$('tall').remove();
		await loop.run(100);
		expect(seen).toEqual(['208 below true']);
	});

	it('a root margin widens the viewport', async () => {
		const { loop, IO, seen, $ } = page(
			'<div style="height: 1000px"></div><p id="near">near</p><div style="height: 2000px"></div><p id="far">far</p>'
		);
		const io = new IO(
			(entries) => {
				for (const e of entries) seen.push(`${e.target.id} ${e.isIntersecting}`);
			},
			{ rootMargin: '600px' }
		);
		io.observe($('near'));
		io.observe($('far'));
		await loop.run(100);
		expect(seen).toEqual(['near true', 'far false']);
	});

	it('an element out of the layout has no box: hidden, display none or contents (what it renders has)', () => {
		const { w } = page(
			'<p id="a" hidden>a</p><div id="b" style="display: none">b</div><span id="c" style="display:contents"><b id="d">d</b></span>'
		);
		const at = boxes(w.document as unknown as Document);
		const box = (id: string) => at.get(w.document.getElementById(id) as unknown as Element);
		expect(box('a')?.h).toBe(0);
		expect(box('b')?.h).toBe(0);
		expect(box('c')).toMatchObject({ w: 0, h: 0 });
		expect(box('d')?.h).toBeGreaterThan(0);
	});
});
