// THE LOAD SCHEDULER (runtime/load-scheduler.ts): every download ogygia starts on its own asks for a
// slot. Island code and background work wait for the painted document and the page's critical
// resources (`fetchpriority="high"`), or the visitor's first input, or a cap; background classes share
// a small window, `ahead` before `speculative`; a gesture never waits; visible content never waits.
//
// REGRESSION (a field report, 2026-10-07): on country home pages the hero image (the LCP, marked
// fetchpriority="high") shared its bandwidth with 206 island requests once the wake gate opened —
// 1.19 s → 2.27 s, LCP about 1 s worse.
import { expect, test, beforeEach, afterEach } from 'vitest';
import {
	BACKGROUND_WINDOW,
	critical_outcome,
	critical_settled,
	fetch_priority_of,
	LoadSlot,
	preload_urls,
	reset_load_scheduler,
	viewport_class
} from '../../src/runtime/load-scheduler.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';
import { PRIORITY } from '../../src/runtime/load-class.ts';
import { flights } from '@ogygia/machine';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A critical image that has not arrived: `complete` false until the test fires its load. */
function pending_hero(): HTMLImageElement {
	const img = document.createElement('img');
	img.setAttribute('fetchpriority', 'high');
	Object.defineProperty(img, 'complete', { configurable: true, get: () => false });
	document.body.appendChild(img);
	return img;
}

/** A shared download queued as a guess (a page prefetch): `join` is a caller joining its flight at
 *  a higher class (a click on the link), which raises it. */
function queued_guess(label: string): {
	ready: Promise<() => void>;
	join: (cls: 'user' | 'visible') => void;
} {
	let slot!: LoadSlot;
	const downloads = flights({
		run: (_key: string, _signal, flight) => {
			slot = new LoadSlot({ kind: 'content', cls: 'speculative', label, flight });
			return slot.ready;
		}
	});
	void downloads.get(label, { priority: PRIORITY.speculative }); // (its run starts inside the get)
	// (the slot's own turn: its holder's start-up runs in the drain's microtask, as a download's does)
	return {
		ready: slot.ready,
		join: (cls) => void downloads.get(label, { priority: PRIORITY[cls] })
	};
}

beforeEach(() => {
	reset_load_scheduler();
	reset_document_painted();
});
afterEach(() => {
	document.body.innerHTML = '';
});

test('priorities and the viewport class', () => {
	expect(fetch_priority_of('user')).toBe('high');
	expect(fetch_priority_of('visible')).toBe('auto');
	expect(fetch_priority_of('ahead')).toBe('low');
	expect(fetch_priority_of('speculative')).toBe('low');
	const on = document.createElement('div');
	on.style.cssText = 'width:10px;height:10px';
	const off = document.createElement('div');
	off.style.cssText = `position:absolute;top:${innerHeight + 500}px;width:10px;height:10px`;
	document.body.append(on, off);
	expect(viewport_class(on)).toBe('visible');
	expect(viewport_class(off)).toBe('ahead');
});

test('a region with no box of its own is classed by what it renders', () => {
	// REGRESSION (field report on 0069b94b): a region wrapping a `position: fixed` button measured
	// 0×0, was classed `ahead` and waited for the critical gate though its button was on screen
	const fixed = document.createElement('div');
	fixed.innerHTML = '<button style="position:fixed;top:64px;left:8px">open</button>';
	const contents = document.createElement('div');
	contents.style.display = 'contents';
	contents.innerHTML = '<p style="margin:0">hello</p>';
	// below the fold, each with nothing on screen
	const far = `position:absolute;top:${innerHeight + 500}px;width:100px`;
	const fixed_off = document.createElement('div');
	fixed_off.style.cssText = far;
	fixed_off.innerHTML = `<button style="position:fixed;top:${innerHeight + 200}px">far</button>`;
	const empty = document.createElement('div');
	empty.style.cssText = far;
	document.body.append(fixed, contents, fixed_off, empty);
	expect(fixed.getBoundingClientRect().height).toBe(0);
	expect(viewport_class(fixed)).toBe('visible');
	expect(viewport_class(contents)).toBe('visible');
	expect(viewport_class(fixed_off)).toBe('ahead');
	expect(viewport_class(empty)).toBe('ahead');
});

test('island code waits for the critical image; a gesture and visible content do not', async () => {
	const hero = pending_hero();
	const started: string[] = [];
	const ask = (label: string, kind: 'code' | 'content', cls: 'user' | 'visible' | 'ahead') =>
		new LoadSlot({ kind, cls, label }).ready.then((release) => {
			started.push(label);
			release();
		});
	void ask('visible code', 'code', 'visible');
	void ask('ahead code', 'code', 'ahead');
	void ask('user code', 'code', 'user');
	void ask('visible html', 'content', 'visible');
	await tick(50); // past the painted frame
	expect(started.sort()).toEqual(['user code', 'visible html']);
	hero.dispatchEvent(new Event('load'));
	await tick();
	expect(started.sort()).toEqual(['ahead code', 'user code', 'visible code', 'visible html']);
	expect(critical_outcome()?.outcome).toBe('arrived');
});

test('the visitor’s first input releases the wait (the browser stops measuring LCP there)', async () => {
	pending_hero();
	let started = false;
	void new LoadSlot({ kind: 'code', cls: 'visible' }).ready.then(() => (started = true));
	await tick(50);
	expect(started).toBe(false);
	document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	await tick();
	expect(started).toBe(true);
	expect(critical_outcome()?.outcome).toBe('input');
});

test('a per-breakpoint preload whose media does not match is never waited for', async () => {
	// the browser fetches only the matching one; the others never settle (every page hit the cap)
	const off = document.createElement('link');
	off.rel = 'preload';
	off.setAttribute('as', 'image');
	off.setAttribute('fetchpriority', 'high');
	off.media = '(max-width: 1px)';
	off.href = '/never-fetched.jpg';
	document.head.appendChild(off);
	await critical_settled();
	expect(critical_outcome()?.outcome).toBe('none');
	off.remove();
});

test('an imagesrcset preload (no href) is matched by any of its candidates', () => {
	const link = document.createElement('link');
	link.setAttribute('imagesrcset', ' /hero-560.jpg 560w,\n\t/hero-1200.jpg\t1200w, ');
	expect(preload_urls(link)).toEqual([
		new URL('/hero-560.jpg', document.baseURI).href,
		new URL('/hero-1200.jpg', document.baseURI).href
	]);
	link.href = '/one.jpg';
	expect(preload_urls(link)).toEqual([new URL('/one.jpg', document.baseURI).href]);
	expect(preload_urls(document.createElement('link'))).toEqual([]);
});

test('no marked resource: code starts right after the paint', async () => {
	await critical_settled();
	expect(critical_outcome()).toEqual({
		outcome: 'none',
		resources: 0,
		waited_ms: expect.any(Number)
	});
	let started = false;
	void new LoadSlot({ kind: 'code', cls: 'visible' }).ready.then(() => (started = true));
	await tick();
	expect(started).toBe(true);
});

test('background work shares a window; ahead goes before speculative; release lets the next in', async () => {
	await critical_settled();
	const started: string[] = [];
	const releases: (() => void)[] = [];
	const ask = (label: string, cls: 'ahead' | 'speculative') =>
		void new LoadSlot({ kind: 'content', cls, label }).ready.then((release) => {
			started.push(label);
			releases.push(release);
		});
	ask('s1', 'speculative');
	ask('s2', 'speculative');
	ask('s3', 'speculative');
	await tick();
	expect(started).toEqual(['s1', 's2', 's3'].slice(0, BACKGROUND_WINDOW));
	ask('s4', 'speculative');
	ask('a1', 'ahead');
	await tick();
	expect(started.length).toBe(BACKGROUND_WINDOW);
	releases[0]();
	await tick();
	expect(started.at(-1)).toBe('a1'); // ahead outranks a speculative that queued first
	releases[1]();
	await tick();
	expect(started.at(-1)).toBe('s4');
});

test('a queued download follows the viewport, and a more urgent join of its flight lifts it', async () => {
	await critical_settled();
	const hold: (() => void)[] = [];
	for (let i = 0; i < BACKGROUND_WINDOW; i++)
		void new LoadSlot({ kind: 'content', cls: 'ahead' }).ready.then((r) => hold.push(r));
	await tick();
	let cls: 'ahead' | 'visible' = 'ahead';
	let started = false;
	void new LoadSlot({ kind: 'code', cls: () => cls }).ready.then(() => (started = true));
	await tick();
	expect(started).toBe(false); // ahead: the window is full
	cls = 'visible';
	dispatchEvent(new Event('scroll'));
	await tick(40);
	expect(started).toBe(true); // scrolled into view: visible code is not windowed

	let promoted = false;
	const queued = queued_guess('q');
	void queued.ready.then(() => (promoted = true));
	await tick();
	expect(promoted).toBe(false);
	queued.join('user');
	await tick();
	expect(promoted).toBe(true);
	for (const r of hold) r();
});

test('starts go out across tasks: holders with heavy start-ups never make one long task', async () => {
	// REGRESSION (CI, a 4×-throttled runner): the gate opened and all 21 islands of a page ran their
	// start-up (graph links, imports, the runtime's lazy chunks) in the task that opened it — 52 ms
	await critical_settled();
	const long: number[] = [];
	const observer = new PerformanceObserver((list) => {
		for (const e of list.getEntries()) long.push(Math.round(e.duration));
	});
	observer.observe({ type: 'longtask' });
	const busy = (ms: number) => {
		const until = performance.now() + ms;
		while (performance.now() < until) {
			/* a holder's synchronous start-up */
		}
	};
	let started = 0;
	// 8 × 12 ms = 96 ms of start-up: in one task, a long one; against a 16 ms budget, none
	const all = Array.from({ length: 8 }, () =>
		new LoadSlot({ kind: 'code', cls: 'visible' }).ready.then((release) => {
			started++;
			busy(12);
			release();
		})
	);
	await Promise.all(all);
	await tick(50);
	observer.disconnect();
	expect(started).toBe(8);
	expect(long).toEqual([]);
});

test('a single start still goes out at once (no yield before the first)', async () => {
	await critical_settled();
	let started = false;
	void new LoadSlot({ kind: 'code', cls: 'user' }).ready.then(() => (started = true));
	await Promise.resolve();
	await Promise.resolve();
	expect(started).toBe(true);
});

// ── the order a drain keeps ──────────────────────────────────────────────────────────────────────
// A drain reads every queued class once and goes by class, then in the order asked (it was a sort
// of the whole queue on every drain). These pin the order and the moments the classes are read.

type Cls = 'user' | 'visible' | 'ahead' | 'speculative';

/** Fills the background window with downloads that never end on their own. */
async function fill_window(): Promise<Array<() => void>> {
	const hold: Array<() => void> = [];
	for (let i = 0; i < BACKGROUND_WINDOW; i++)
		void new LoadSlot({ kind: 'content', cls: 'ahead' }).ready.then((r) => hold.push(r));
	await tick();
	expect(hold.length).toBe(BACKGROUND_WINDOW);
	return hold;
}

test('the gate opening starts each class in the order asked, whatever order the classes came in', async () => {
	const hero = pending_hero();
	const started: string[] = [];
	const releases: Array<() => void> = [];
	const ask = (label: string, cls: Cls | (() => Cls)) =>
		void new LoadSlot({ kind: 'code', cls, label }).ready.then((release) => {
			started.push(label);
			releases.push(release);
		});
	ask('s1', 'speculative');
	ask('a1', () => 'ahead');
	ask('v1', 'visible');
	ask('s2', () => 'speculative');
	ask('a2', 'ahead');
	ask('v2', () => 'visible');
	ask('a3', 'ahead');
	await tick(50);
	expect(started).toEqual([]);
	hero.dispatchEvent(new Event('load'));
	await tick();
	expect(started).toEqual(['v1', 'v2', 'a1', 'a2', 'a3']);
	releases[2](); // a1's: the window lets the first speculative in
	await tick();
	expect(started.at(-1)).toBe('s1');
	releases[3]();
	await tick();
	expect(started.at(-1)).toBe('s2');
	for (const r of releases) r();
});

test('a class that changed with no event is read at the next drain, whatever asked for it', async () => {
	await critical_settled();
	const hold = await fill_window();
	let cls: Cls = 'ahead';
	const started: string[] = [];
	void new LoadSlot({ kind: 'code', cls: () => cls, label: 'g' }).ready.then(() =>
		started.push('g')
	);
	await tick();
	cls = 'visible'; // a layout shift: no scroll, nothing tells the queue
	await tick();
	expect(started).toEqual([]);
	// an unrelated ask drains the queue: the class is read again, and the window does not apply
	void new LoadSlot({ kind: 'content', cls: 'speculative', label: 'x' }).ready.then(() =>
		started.push('x')
	);
	await tick();
	expect(started).toEqual(['g']);
	for (const r of hold) r();
});

test('a class a holder’s start-up changes is read again in the same drain', async () => {
	await critical_settled();
	const hold = await fill_window();
	let cls: Cls = 'ahead';
	const started: string[] = [];
	void new LoadSlot({ kind: 'code', cls: () => cls, label: 'g' }).ready.then(() =>
		started.push('g')
	);
	// a guess that waits for the window; the visitor then wants it (its holder already waits)
	const u = queued_guess('u');
	void u.ready.then(() => {
		started.push('u');
		cls = 'visible'; // what the visitor's page adds moves the other one on screen
	});
	await tick();
	expect(started).toEqual([]);
	u.join('user');
	await tick();
	expect(started).toEqual(['u', 'g']);
	for (const r of hold) r();
});

test('a slot asked for while a drain starts others goes in that drain, after the rest, in the order asked', async () => {
	const hero = pending_hero();
	const started: string[] = [];
	const releases: Array<() => void> = [];
	const ask = (label: string, cls: Cls, then?: () => void) =>
		void new LoadSlot({ kind: 'code', cls, label }).ready.then((release) => {
			started.push(label);
			releases.push(release);
			then?.();
		});
	// island code waits for the critical image; when it arrives, its start-up asks for two more
	ask('v1', 'visible', () => {
		ask('a', 'ahead');
		ask('v2', 'visible');
	});
	await tick(50);
	expect(started).toEqual([]);
	hero.dispatchEvent(new Event('load'));
	await tick();
	// (the next drain would put `v2` first; the one running reaches them in the order asked)
	expect(started).toEqual(['v1', 'a', 'v2']);
	for (const r of releases) r();
});

test('the scroll watch ends in the frame that starts the last queued slot', async () => {
	await critical_settled();
	const hold = await fill_window();
	let cls: Cls = 'ahead';
	let started = false;
	void new LoadSlot({ kind: 'code', cls: () => cls }).ready.then(() => (started = true));
	await tick();
	const removed: string[] = [];
	const remove = window.removeEventListener;
	window.removeEventListener = function (this: Window, ...args: Parameters<typeof remove>) {
		removed.push(String(args[0]));
		return remove.apply(this, args);
	} as typeof remove;
	try {
		cls = 'visible';
		dispatchEvent(new Event('scroll'));
		await tick(40);
	} finally {
		window.removeEventListener = remove;
	}
	expect(started).toBe(true);
	expect(removed).toContain('scroll');
	for (const r of hold) r();
});
