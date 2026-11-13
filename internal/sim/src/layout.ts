/**
 * A SIMULATED DOCUMENT'S LAYOUT, and the IntersectionObserver that reads it. happy-dom lays nothing
 * out and its IntersectionObserver is a stub that never reports, so in the simulator no
 * `wake: 'visible'` island ever woke by being seen and the hydration drain waited for a viewport
 * snapshot on every turn (found by the differential, src/differ.ts; test/layout.test.ts).
 *
 * The layout is block flow on the real-browser player's viewport (1280x720, never scrolled): block
 * elements stack, inline content runs in lines (8 px a character, 20 px a line), a replaced element
 * takes its `width`/`height` (or 300x150), the default margins of the common blocks, and an inline
 * `height` in px. What has no box: `hidden`, the head's elements, `display: none`, and
 * `display: contents` (its content lays out in its place). Stylesheets are not read: a class that
 * sizes or hides something is not seen. Close enough to put the top of a page on screen and the
 * rest below it, as a browser does; the differential shows where it is not.
 *
 * The observer reports as a browser's does: each target it starts observing at the next frame,
 * then each whose crossing changed, at the first frame after the document changed. A frame is a
 * task of the document's realm on the loop, so it replays.
 */
import type { Loop } from './loop.ts';

/** A box, in px from the document's top left. */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The player's viewport (Playwright's default). */
export const VIEWPORT = { w: 1280, h: 720 } as const;

const CHAR = 8;
const LINE = 20;
const NO_BOX = new Set([
	'head',
	'script',
	'style',
	'template',
	'noscript',
	'meta',
	'link',
	'title',
	'base'
]);
const BLOCK = new Set([
	'html',
	'body',
	'address',
	'article',
	'aside',
	'blockquote',
	'details',
	'dialog',
	'div',
	'dl',
	'dd',
	'dt',
	'fieldset',
	'figcaption',
	'figure',
	'footer',
	'form',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hgroup',
	'hr',
	'li',
	'main',
	'nav',
	'ol',
	'p',
	'pre',
	'section',
	'summary',
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'td',
	'th',
	'caption',
	'ul',
	'menu',
	'legend',
	'search'
]);
const REPLACED = new Set(['img', 'video', 'canvas', 'iframe', 'svg', 'object', 'embed']);
const CONTROL = new Set(['input', 'select', 'textarea', 'button']);
/** Default block margins, top and bottom (a browser's user agent sheet, roughly). */
const MARGIN: Record<string, number> = {
	p: 16,
	ul: 16,
	ol: 16,
	dl: 16,
	blockquote: 16,
	figure: 16,
	pre: 16,
	fieldset: 8,
	hr: 8,
	h1: 21,
	h2: 20,
	h3: 19,
	h4: 21,
	h5: 22,
	h6: 25
};

/** A computed length in px (happy-dom resolves `rem`, `em`, `vh` to px), or null. */
function px(value: string | undefined): number | null {
	if (value === undefined || !value.endsWith('px')) return null;
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : null;
}

/** Every element's box in `doc` (an element with none has a box of no size where it would be). */
export function boxes(doc: Document): Map<Element, Box> {
	const view = doc.defaultView as unknown as {
		getComputedStyle(el: Element): Record<string, string | undefined>;
	};
	const css = (el: Element) => view.getComputedStyle(el);
	const out = new Map<Element, Box>();
	let x = 0;
	let y = 0;
	let line = 0;
	const flush = () => {
		if (x > 0 || line > 0) y += Math.max(line, LINE);
		x = 0;
		line = 0;
	};
	/** Places an inline piece `w` x `h` on the line, wrapping; its box. */
	const place = (w: number, h: number): Box => {
		if (x > 0 && x + w > VIEWPORT.w) flush();
		const at = { x, y, w: Math.min(w, VIEWPORT.w), h };
		x += Math.min(w, VIEWPORT.w);
		line = Math.max(line, h);
		return at;
	};
	const union = (list: Box[]): Box | null => {
		if (list.length === 0) return null;
		const x0 = Math.min(...list.map((b) => b.x));
		const y0 = Math.min(...list.map((b) => b.y));
		const x1 = Math.max(...list.map((b) => b.x + b.w));
		const y1 = Math.max(...list.map((b) => b.y + b.h));
		return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
	};
	const none = (el: Element) => {
		out.set(el, { x, y, w: 0, h: 0 });
		for (const c of el.querySelectorAll('*')) out.set(c, { x, y, w: 0, h: 0 });
	};
	/** Lays out `node`; the boxes its content took (for its parent's union). */
	const walk = (node: Node): Box[] => {
		if (node.nodeType === 3) {
			const text = (node.textContent ?? '').replace(/\s+/g, ' ');
			if (text.trim() === '') return [];
			let width = text.length * CHAR;
			const parts: Box[] = [];
			while (width > 0) {
				const room = VIEWPORT.w - x;
				if (room <= 0) flush();
				const take = Math.min(width, VIEWPORT.w - x);
				parts.push(place(take, LINE));
				width -= take;
			}
			return parts;
		}
		if (node.nodeType !== 1) return [];
		const el = node as Element;
		const tag = el.localName;
		const cs = css(el);
		const display = cs.display ?? '';
		if (NO_BOX.has(tag) || el.hasAttribute('hidden') || display === 'none') {
			none(el);
			return [];
		}
		if (display === 'contents') {
			out.set(el, { x, y, w: 0, h: 0 });
			const inner: Box[] = [];
			for (const c of el.childNodes) inner.push(...walk(c));
			return inner;
		}
		if (tag === 'br') {
			const b = place(0, LINE);
			flush();
			out.set(el, b);
			return [b];
		}
		if (REPLACED.has(tag) || CONTROL.has(tag)) {
			const text = tag === 'button' ? (el.textContent ?? '').trim().length * CHAR + 16 : 0;
			const w = Number(el.getAttribute('width')) || (CONTROL.has(tag) ? Math.max(text, 150) : 300);
			const h = Number(el.getAttribute('height')) || (CONTROL.has(tag) ? 24 : 150);
			const b = place(w, h);
			out.set(el, b);
			for (const c of el.querySelectorAll('*')) out.set(c, { ...b });
			return [b];
		}
		// (out of flow: laid out where it would start, and the flow goes on as if it were not there)
		if (cs.position === 'fixed' || cs.position === 'absolute') {
			const at = { x, y, line };
			const inner = walk_block(el, tag, cs);
			({ x, y, line } = at);
			return inner;
		}
		const block =
			display === ''
				? BLOCK.has(tag)
				: !['inline', 'inline-block', 'inline-flex', 'inline-grid'].includes(display);
		if (!block) {
			const inner: Box[] = [];
			for (const c of el.childNodes) inner.push(...walk(c));
			const b = union(inner) ?? { x, y, w: 0, h: 0 };
			out.set(el, b);
			return inner;
		}
		return walk_block(el, tag, cs);
	};
	/** A block: on lines of its own, its margins, borders, padding and a set height or min-height. */
	const walk_block = (el: Element, tag: string, cs: Record<string, string | undefined>): Box[] => {
		flush();
		const fallback = tag === 'body' ? 8 : (MARGIN[tag] ?? 0);
		const above = px(cs.marginTop) ?? fallback;
		const below = px(cs.marginBottom) ?? fallback;
		const inside_top = (px(cs.borderTopWidth) ?? 0) + (px(cs.paddingTop) ?? 0);
		const inside_bottom = (px(cs.borderBottomWidth) ?? 0) + (px(cs.paddingBottom) ?? 0);
		y += above;
		const top = y;
		y += inside_top;
		const content = y;
		if (tag === 'details' && !el.hasAttribute('open')) {
			for (const c of el.children)
				if (c.localName === 'summary') walk(c);
				else none(c);
		} else if (tag === 'dialog' && !el.hasAttribute('open')) none(el);
		else for (const c of el.childNodes) walk(c);
		flush();
		const height = px(cs.height);
		if (height !== null) y = content + height;
		const min = px(cs.minHeight);
		if (min !== null) y = Math.max(y, content + min);
		if (tag === 'hr') y = Math.max(y, top + 2);
		y += inside_bottom;
		const b = { x: 0, y: top, w: VIEWPORT.w, h: y - top };
		y += below;
		out.set(el, b);
		return [b];
	};
	if (doc.documentElement) walk(doc.documentElement);
	return out;
}

/** `rootMargin` as px on each side (top, right, bottom, left); `%` of the viewport. */
function margins(root_margin: string | undefined): [number, number, number, number] {
	const parts = (root_margin ?? '0px').trim().split(/\s+/);
	const px = (s: string, of: number) =>
		s.endsWith('%') ? (parseFloat(s) / 100) * of : parseFloat(s) || 0;
	const [t = '0px', r = t, b = t, l = r] = parts;
	return [px(t, VIEWPORT.h), px(r, VIEWPORT.w), px(b, VIEWPORT.h), px(l, VIEWPORT.w)];
}

/** The viewport grown by `root_margin`. */
function root_of(root_margin: string | undefined): Box {
	const [t, r, b, l] = margins(root_margin);
	return { x: -l, y: -t, w: VIEWPORT.w + l + r, h: VIEWPORT.h + t + b };
}

/** Whether `box` crosses `root` (an edge touching counts, as a browser's threshold 0 does). */
function crosses(box: Box, root: Box): boolean {
	return (
		box.x <= root.x + root.w &&
		box.x + box.w >= root.x &&
		box.y <= root.y + root.h &&
		box.y + box.h >= root.y
	);
}

/**
 * Whether `el` is on screen in the layout `at` (the viewport grown by `root_margin`), by the one rule
 * ogygia's `visible` keeps (packages/core/src/runtime/viewport.ts): an element with an area is on
 * screen when its box crosses the root; one with none, when one of what it renders is (its first 16
 * children, 3 levels down), or, with nothing of its own on screen, when a line of its own crosses.
 * What an oracle owes a `visible` schedule at rest: the observer reported the same layout.
 */
export function on_screen(at: Map<Element, Box>, el: Element, root_margin?: string): boolean {
	const root = root_of(root_margin);
	const decide = (e: Element, depth: number): boolean => {
		const box = e.isConnected ? at.get(e) : undefined;
		if (box === undefined) return false;
		const on = crosses(box, root);
		if (box.w > 0 && box.h > 0) return on;
		if (depth > 0)
			for (let c = e.firstElementChild, n = 0; c && n < 16; c = c.nextElementSibling, n++)
				if (decide(c, depth - 1)) return true;
		return on && (box.w > 0 || box.h > 0);
	};
	return decide(el, 3);
}

type Target = Element & { readonly isConnected: boolean };
type Callback = (entries: object[], observer: object) => void;

/**
 * Gives `window` (a document of realm `realm`) its layout's IntersectionObserver. Its frames are
 * tasks of `realm` on `loop`; a closed window's frame does nothing.
 */
export function install_layout(window: object, loop: Loop, realm: string): void {
	const w = window as {
		document: Document;
		closed: boolean;
		MutationObserver: new (cb: () => void) => {
			observe(n: Node, o: object): void;
			disconnect(): void;
		};
		performance: { now(): number };
	};
	const observers = new Set<Observer>();
	let frame: { cancelled: boolean } | null = null;
	let dirty = true;
	/** The layout the last frame made (or a look made, before any frame). */
	let last_boxes: Map<Element, Box> | null = null;
	/** The next frame, once: every observer looks then, from one layout. */
	const ask_frame = () => {
		if (frame !== null && !frame.cancelled) return;
		const wait = 16 - (loop.now % 16) || 16;
		frame = loop.add(realm, 'intersection', wait, () => {
			frame = null;
			if (w.closed) return;
			// (the frame keeps the layout it made, observers or not: test/layout.test.ts)
			if (dirty) last_boxes = boxes(w.document);
			dirty = false;
			// (a copy: a callback may stop an observer)
			for (const o of Array.from(observers)) o.look();
		});
	};
	// (the document changed: what is on screen may have; the host's own ear, not the page's)
	let watching = false;
	const watch = () => {
		if (watching) return;
		watching = true;
		new w.MutationObserver(() => {
			dirty = true;
			if (observers.size > 0) ask_frame();
		}).observe(w.document, {
			childList: true,
			subtree: true,
			attributes: true,
			characterData: true
		});
	};
	class Observer {
		readonly #callback: Callback;
		readonly #root: Box;
		/** Each target and whether it crossed when last reported (undefined: not reported yet). */
		readonly #targets = new Map<Target, boolean | undefined>();
		readonly rootMargin: string;
		readonly thresholds: readonly number[] = [0];
		readonly root = null;
		constructor(callback: Callback, options?: { rootMargin?: string }) {
			this.#callback = callback;
			this.rootMargin = options?.rootMargin ?? '0px';
			this.#root = root_of(options?.rootMargin);
		}
		observe(target: Target): void {
			if (this.#targets.has(target)) return;
			this.#targets.set(target, undefined);
			observers.add(this as unknown as Observer);
			watch();
			ask_frame();
		}
		unobserve(target: Target): void {
			this.#targets.delete(target);
			if (this.#targets.size === 0) observers.delete(this as unknown as Observer);
		}
		disconnect(): void {
			this.#targets.clear();
			observers.delete(this as unknown as Observer);
		}
		takeRecords(): object[] {
			return [];
		}
		/** At a frame: each target new or changed, reported. */
		look(): void {
			const at = last_boxes ?? (last_boxes = boxes(w.document));
			const root = this.#root;
			const entries: object[] = [];
			for (const [target, was] of this.#targets) {
				const box = (target.isConnected ? at.get(target) : undefined) ?? { x: 0, y: 0, w: 0, h: 0 };
				const on = target.isConnected && crosses(box, root);
				if (was === on) continue;
				this.#targets.set(target, on);
				const rect = {
					x: box.x,
					y: box.y,
					width: box.w,
					height: box.h,
					top: box.y,
					left: box.x,
					right: box.x + box.w,
					bottom: box.y + box.h
				};
				entries.push({
					target,
					isIntersecting: on,
					intersectionRatio: on && box.w * box.h > 0 ? 1 : 0,
					boundingClientRect: rect,
					intersectionRect: on ? rect : { ...rect, width: 0, height: 0 },
					rootBounds: { x: 0, y: 0, width: VIEWPORT.w, height: VIEWPORT.h },
					time: w.performance.now()
				});
			}
			if (entries.length > 0) this.#callback(entries, this);
		}
	}
	Object.defineProperty(window, 'IntersectionObserver', {
		value: Observer,
		writable: true,
		configurable: true
	});
}
