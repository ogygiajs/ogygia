/**
 * Where happy-dom would leak real time or do what a browser does not, set right in this process
 * only (its package is not patched; each change replaces one method on a happy-dom prototype, at
 * run time, and says why). modules.ts does the same for the module compiler.
 *
 * - `inert_parsed_documents`: a parsed document loads nothing.
 * - `completion_on_the_loop`: a document's `load` event and `readyState` come on virtual time.
 */
import { HTMLLinkElement, HTMLScriptElement } from 'happy-dom';
import ECMAScriptModule from 'happy-dom/lib/module/ECMAScriptModule.js';
import AsyncTaskManager from 'happy-dom/lib/async-task-manager/AsyncTaskManager.js';
import BrowserFrame from 'happy-dom/lib/browser/BrowserFrame.js';
import BrowserFrameNavigator from 'happy-dom/lib/browser/utilities/BrowserFrameNavigator.js';
import Location from 'happy-dom/lib/location/Location.js';
import HistoryItemList from 'happy-dom/lib/history/HistoryItemList.js';
import HTMLParser from 'happy-dom/lib/html-parser/HTMLParser.js';
import Document from 'happy-dom/lib/nodes/document/Document.js';
import HTMLElement from 'happy-dom/lib/nodes/html-element/HTMLElement.js';
import * as PropertySymbol from 'happy-dom/lib/PropertySymbol.js';
import XMLEncodeUtility from 'happy-dom/lib/utilities/XMLEncodeUtility.js';
import WindowBrowserContext from 'happy-dom/lib/window/WindowBrowserContext.js';
import type { Loop, Task } from './loop.ts';

/**
 * A parsed document (`DOMParser`, a `<template>`'s content) is inert, as in a browser: it has no
 * browsing context, so its `<link>`s load nothing. happy-dom loads them anyway (a modulepreload or a
 * `preload as=fetch` in a parsed page fetches, with its href resolved against the page on screen),
 * which the router's parse of the next page would turn into requests a browser never sends. So a
 * link whose document is not its window's document finds no browsing context while it connects or
 * changes. Idempotent.
 */
export function inert_parsed_documents(): void {
	const proto = HTMLLinkElement.prototype as unknown as Record<symbol | string, unknown>;
	if (proto.__inert) return;
	proto.__inert = true;
	const context = WindowBrowserContext.prototype as unknown as { getBrowserFrame(): unknown };
	const frame = context.getBrowserFrame;
	let inert = 0;
	context.getBrowserFrame = function (this: unknown) {
		return inert > 0 ? null : frame.call(this);
	};
	for (const key of [PropertySymbol.connectedToDocument, PropertySymbol.onSetAttribute]) {
		const real = proto[key] as (...a: unknown[]) => unknown;
		proto[key] = function (
			this: Record<symbol, { document?: unknown } | undefined>,
			...a: unknown[]
		) {
			const parsed = this[PropertySymbol.ownerDocument] !== this[PropertySymbol.window]?.document;
			if (parsed) inert++;
			try {
				return real.apply(this, a);
			} finally {
				if (parsed) inert--;
			}
		};
	}
}

/**
 * A document with no browsing context (`createHTMLDocument`, `DOMParser`, a template's contents)
 * has no custom element registry, as in a browser: an element made or connected there is not built
 * by its component's constructor; it is when it enters the page. happy-dom builds it in any
 * document of the window (ogygia's inert parse, ./runtime/parse-html.ts, relies on the browser's
 * behaviour, and its `rule_parse_upgraded` says so). Here such a document sees an empty registry
 * while it makes or connects an element. Idempotent.
 */
export function inert_custom_elements(): void {
	const doc = Document.prototype as unknown as Record<symbol | string, unknown>;
	if (doc.__inert) return;
	doc.__inert = true;
	type Registry = Record<symbol, unknown>;
	const registry_of = (node: Record<symbol, unknown>): Registry | null => {
		const w = node[PropertySymbol.window] as
			| { document?: unknown; customElements?: Registry }
			| undefined;
		const own = (node[PropertySymbol.ownerDocument] ?? node) as unknown;
		return w?.customElements !== undefined && own !== w.document ? w.customElements : null;
	};
	const without = <T>(registry: Registry | null, key: symbol, empty: unknown, run: () => T): T => {
		if (registry === null) return run();
		const real = registry[key];
		registry[key] = empty;
		try {
			return run();
		} finally {
			registry[key] = real;
		}
	};
	// the fragment parser (innerHTML, a template, `setHTMLUnsafe`, DOMParser) never builds a custom
	// element as it parses: only the document's own parser does, and connecting upgrades the rest
	const parser = HTMLParser.prototype as unknown as {
		parse(
			this: { window: { document: unknown; customElements: Registry } },
			...a: unknown[]
		): unknown;
	};
	const parse = parser.parse;
	parser.parse = function (...a: unknown[]) {
		const own = a[1] === this.window.document;
		return without(
			own ? null : this.window.customElements,
			PropertySymbol.registry,
			new Map(),
			() => parse.apply(this, a)
		);
	};
	const el = HTMLElement.prototype as unknown as Record<symbol, unknown>;
	const connected = el[PropertySymbol.connectedToDocument] as (...a: unknown[]) => unknown;
	el[PropertySymbol.connectedToDocument] = function (
		this: Record<symbol, unknown>,
		...a: unknown[]
	) {
		return without(registry_of(this), PropertySymbol.callbacks, undefined, () =>
			connected.apply(this, a)
		);
	};
}

/**
 * A run of text is one text node, as a browser's parser makes it. happy-dom's parser hands a bare
 * `>` in text (`() => x`) to a text node of its own, so the run became two nodes, and Svelte,
 * hydrating the server's one text, found a node left over (seed 477). A run the parser goes on
 * with joins the text node it just made. Idempotent. Without it until now: test/parser.test.ts.
 */
export function whole_text_runs(): void {
	const parser = HTMLParser.prototype as unknown as {
		__runs?: boolean;
		parsePlainText(this: Parsing, text: string): void;
	};
	if (parser.__runs) return;
	parser.__runs = true;
	type Parsing = {
		currentNode: Node | null;
		rootNode: Node;
		documentStructure: { nodes: { documentElement: Node; head: Node } } | null;
	};
	const plain = parser.parsePlainText;
	// (the text nodes a parse made: a node that was there before it, as at `insertAdjacentHTML`,
	// stays apart, as in a browser)
	const made = new WeakSet<Node>();
	parser.parsePlainText = function (text) {
		const node = this.currentNode;
		const top = this.documentStructure?.nodes;
		const last = node?.lastChild;
		// (in an element of the page: around <html> and <head>, happy-dom's own rules place text)
		if (
			node !== null &&
			(top === undefined || node !== this.rootNode) &&
			node !== top?.documentElement &&
			node !== top?.head &&
			last != null &&
			made.has(last)
		) {
			const run = last as unknown as Record<symbol, string>;
			run[PropertySymbol.data] += XMLEncodeUtility.decodeHTMLEntities(text);
			return;
		}
		plain.call(this, text);
		const now = node?.lastChild;
		if (now?.nodeType === 3) made.add(now);
	};
}

/**
 * A document's module scripts run in its order, as a browser runs them: each one its parser put in
 * the document (not `async`) runs after the ones above it, once they have run or failed to load.
 * happy-dom runs an inline module at once and an external one when its file comes, so an inline
 * module ran before the runtime's module above it (/island-foreign-edit: a foreign tool edited the
 * islands before the runtime kept their server markup). Idempotent. test/modules.test.ts.
 */
export function modules_in_order(): void {
	const script = HTMLScriptElement.prototype as unknown as Record<symbol | string, unknown>;
	if (script.__ordered) return;
	script.__ordered = true;
	type Entry = {
		url: string;
		inline: boolean;
		started: boolean;
		done: Promise<void>;
		finish: () => void;
	};
	const queues = new WeakMap<object, Entry[]>();
	/** The document its own parser is parsing now (what it connects is parser-inserted). */
	let parsing: unknown = null;
	/** The inline module being connected (happy-dom evaluates it in the same call). */
	let current: Entry | null = null;
	const parser = HTMLParser.prototype as unknown as {
		parse(this: { window: { document: unknown } }, ...a: unknown[]): unknown;
	};
	const parse = parser.parse;
	parser.parse = function (...a: unknown[]) {
		const was = parsing;
		if (a[1] === this.window.document) parsing = a[1];
		try {
			return parse.apply(this, a);
		} finally {
			parsing = was;
		}
	};
	const connect = script[PropertySymbol.connectedToDocument] as (this: unknown) => unknown;
	script[PropertySymbol.connectedToDocument] = function (this: HTMLScriptElement) {
		const doc = this.ownerDocument;
		if (parsing !== doc || this.getAttribute('type') !== 'module' || this.hasAttribute('async'))
			return connect.call(this);
		const src = this.getAttribute('src');
		let finish = (): void => {};
		const done = new Promise<void>((r) => (finish = r));
		const entry: Entry = {
			url: src === null ? '' : new URL(src, doc.location.href).href,
			inline: src === null,
			started: false,
			done,
			finish
		};
		const list = queues.get(doc) ?? [];
		queues.set(doc, list);
		list.push(entry);
		if (src !== null) {
			// (one that never runs, its file failed, lets the ones below it go on)
			this.addEventListener('load', () => entry.finish(), { once: true });
			this.addEventListener('error', () => entry.finish(), { once: true });
			return connect.call(this);
		}
		current = entry;
		try {
			return connect.call(this);
		} finally {
			current = null;
		}
	};
	const module = ECMAScriptModule.prototype as unknown as Record<symbol | string, unknown>;
	const evaluate = module.evaluate as (this: unknown, ...a: unknown[]) => Promise<unknown>;
	module.evaluate = async function (this: Record<symbol | string, unknown>, ...a: unknown[]) {
		const doc = (this[PropertySymbol.window] as { document?: object } | undefined)?.document;
		const list = doc === undefined ? undefined : queues.get(doc);
		const href = String((this.url as { href?: string })?.href ?? this.url);
		const entry =
			list === undefined
				? undefined
				: current !== null && list.includes(current) && !current.started
					? current
					: list.find((e) => !e.inline && !e.started && e.url === href);
		if (list === undefined || entry === undefined) return evaluate.apply(this, a);
		entry.started = true;
		try {
			await Promise.all(list.slice(0, list.indexOf(entry)).map((e) => e.done));
			return await evaluate.apply(this, a);
		} finally {
			entry.finish();
		}
	};
}

/** The document a history entry belongs to (`history_by_document`). */
const DOC = Symbol('ogygia.sim.document');

interface HistoryItem {
	href: string;
	state: unknown;
	popState: boolean;
	method: string;
	formData: unknown;
	[DOC]?: number;
}
interface Frame {
	url: string;
	window: {
		location: Record<symbol, (frame: Frame, href: string) => void>;
		dispatchEvent(e: unknown): boolean;
		PopStateEvent: new (type: string, init: object) => unknown;
	};
	[key: symbol]: unknown;
}
interface Traverse {
	windowClass: unknown;
	frame: Frame;
	goToOptions?: Record<string, unknown>;
	steps?: number;
}

/**
 * A history traversal is same-document only when the entry it goes to belongs to the document on
 * screen (HTML's session history: each entry has its document). happy-dom decides it from a flag
 * that `pushState` sets on the entries it touches, so going back from a page loaded fresh to an
 * entry an earlier document pushed only fires `popstate` on the wrong document, and the reverse
 * reloads nothing it should. Here each entry carries the document it belongs to: a new one for an
 * entry a load makes (and for an entry a traversal or reload loads again), its document's for one
 * `pushState`, `replaceState` or a hash change makes. A traversal to another document's entry
 * loads it; to the shown document's, it moves the URL and fires `popstate`. Idempotent.
 */
export function history_by_document(): void {
	const list = HistoryItemList.prototype as unknown as Record<string, unknown> & {
		__docs?: boolean;
	};
	if (list.__docs) return;
	list.__docs = true;
	let docs = 0;
	type List = { currentItem: HistoryItem; items: HistoryItem[] };
	const push = list.push as (this: List, item: HistoryItem) => void;
	list.push = function (this: List, item: HistoryItem) {
		item[DOC] = item.popState ? this.currentItem[DOC] : ++docs;
		push.call(this, item);
	};
	// (a `replaceState` changes the current entry only: happy-dom also drops every entry after it,
	// so a router that names the entry it starts on would erase the visitor's forward history)
	list.replace = function (this: List, item: HistoryItem) {
		const at = this.items.indexOf(this.currentItem);
		if (at === -1) throw new Error('Current history item not found');
		item[DOC] = this.currentItem[DOC];
		this.items[at] = item;
		this.currentItem = item;
	};
	// (`location.reload()` reloads the entry: happy-dom goes to its address, a new entry that drops
	// the forward ones; the frame's own reload is the browser's)
	const location = Location.prototype as unknown as { reload(this: unknown): void };
	const frame = BrowserFrame.prototype as unknown as {
		goto(this: { reload(): Promise<unknown> }, ...a: unknown[]): Promise<unknown>;
	};
	const real_reload = location.reload;
	const goto = frame.goto;
	let reloading = false;
	location.reload = function (this: unknown) {
		reloading = true;
		try {
			real_reload.call(this);
		} finally {
			reloading = false;
		}
	};
	frame.goto = function (this: { reload(): Promise<unknown> }, ...a: unknown[]) {
		if (!reloading) return goto.apply(this, a);
		reloading = false;
		return this.reload();
	};
	const nav = BrowserFrameNavigator as unknown as Record<string, (o: Traverse) => Promise<unknown>>;
	// (a reload keeps the entry's document state: the entries its document pushed or jumped to
	// share it, and are the NEW document's now, so a step back to one is same-document and fires
	// `popstate` there with the old document's state, as in a browser)
	const traverse = (by: (o: Traverse) => number, real: (o: Traverse) => Promise<unknown>) =>
		function (this: unknown, o: Traverse): Promise<unknown> {
			const history = o.frame[PropertySymbol.history] as List;
			const from = history.currentItem;
			const to = history.items[history.items.indexOf(from) + by(o)];
			if (to === undefined || to === from) return real.call(this, o);
			history.currentItem = to;
			if (to[DOC] !== undefined && to[DOC] === from[DOC]) {
				o.frame.window.location[PropertySymbol.setURL](o.frame, to.href);
				o.frame.window.dispatchEvent(
					new o.frame.window.PopStateEvent('popstate', {
						state: to.state,
						hasUAVisualTransition: false
					})
				);
				return Promise.resolve(null);
			}
			// (its document is loaded again, and every entry that shared the old one shares the new)
			const old = to[DOC];
			const now = ++docs;
			for (const item of history.items)
				if (item === to || (old !== undefined && item[DOC] === old)) item[DOC] = now;
			// (another document's entry loads whole even where only its fragment differs from the
			// address shown: happy-dom's navigate would take that for a fragment jump)
			const shown = o.frame.url.split('#')[0];
			if (shown === to.href.split('#')[0] && to.href !== o.frame.url)
				o.frame.window.location[PropertySymbol.setURL](o.frame, to.href);
			return nav.navigate.call(BrowserFrameNavigator, {
				windowClass: o.windowClass,
				frame: o.frame,
				goToOptions: { ...o.goToOptions, referrer: o.frame.url },
				url: to.href,
				method: to.method,
				formData: to.formData,
				disableHistory: true
			} as unknown as Traverse);
		};
	nav.navigateBack = traverse(() => -1, nav.navigateBack);
	nav.navigateForward = traverse(() => 1, nav.navigateForward);
	const steps = nav.navigateSteps;
	nav.navigateSteps = function (this: unknown, o: Traverse) {
		return o.steps ? traverse((x) => x.steps ?? 0, steps).call(this, o) : steps.call(this, o);
	};
}

let driving: Loop | null = null;

interface Manager {
	runningTaskCount: number;
	runningTimers: unknown[];
	runningImmediates: unknown[];
	waitUntilCompleteTimer: unknown;
	waitUntilCompleteResolvers: Array<{ resolve(): void }>;
	destroyed: boolean;
}

/**
 * happy-dom decides that a document has loaded (its `readyState` turns `complete` and `load` fires)
 * and that a page is idle on a REAL 1 ms timer, set when its last pending task ends: whether that
 * timer fires before or after the next simulated step depends on how fast the host runs, so a
 * page's `load` event would land at a different virtual moment from run to run. Here the timer is
 * a task on `loop`, 1 virtual ms later, while a world drives the DOM (`null` gives the real timer
 * back). The other methods clear the timer with the real `clearTimeout`, which ignores this handle,
 * so a task that is no longer the manager's current one does nothing.
 */
export function completion_on_the_loop(loop: Loop | null): void {
	driving = loop;
	const proto = AsyncTaskManager.prototype as unknown as Record<string, unknown>;
	if (proto.__loop) return;
	proto.__loop = true;
	const real = proto.resolveWhenComplete as (this: Manager) => void;
	proto.resolveWhenComplete = function (this: Manager) {
		const on = driving;
		if (on === null) return real.call(this);
		if (this.runningTaskCount || this.runningTimers.length || this.runningImmediates.length) return;
		const old = this.waitUntilCompleteTimer as Task | { cancelled?: boolean } | null;
		if (old !== null && typeof old === 'object' && 'cancelled' in old) old.cancelled = true;
		// (with no one waiting, the timer would only clear `destroyed`: no task for that)
		if (this.waitUntilCompleteResolvers.length === 0) {
			this.waitUntilCompleteTimer = null;
			this.destroyed = false;
			return;
		}
		const handle: Task = on.add('dom', 'complete', 1, () => {
			if (this.waitUntilCompleteTimer !== handle) return;
			this.waitUntilCompleteTimer = null;
			if (this.runningTaskCount || this.runningTimers.length || this.runningImmediates.length)
				return;
			const resolvers = this.waitUntilCompleteResolvers;
			this.waitUntilCompleteResolvers = [];
			for (const r of resolvers) r.resolve();
			this.destroyed = false;
		});
		this.waitUntilCompleteTimer = handle;
	};
}
