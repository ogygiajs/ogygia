import { flights, random, STALE, type Scope, type Stale } from '@ogygia/machine';
import { fragment_is_top, fragment_target } from './fragment.ts';
import { import_again } from './import-again.ts';
import { kit_hydrates_page } from './kit-boot.ts';
import { create_navigation, type Navigation } from './navigation.ts';
import { slots } from './slots.ts';
import { publish_nav } from './nav-handle.ts';
import { nearest_attr } from './nearest-attr.ts';
import { record_server_body } from './ownership.ts';
import { runtime_session } from './session.ts';
import { once_on_screen } from './viewport.ts';
import { OgygiaError, warn } from '../messages/core.ts';
import { report_thrown } from '../report-thrown.ts';
import { download } from '../policies.ts';
import { watch_router } from './rules.ts';

const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

const WS = /\s+/;

/**
 * The `<a>` a pointer event is about — through SHADOW ROOTS. A click inside a web component's
 * shadow tree (a web component such as `<x-link>`, `<x-button href>`, a breadcrumb item)
 * reaches the document with `event.target` retargeted to the host, so `target.closest('a')` finds
 * nothing and the browser navigates natively — a full reload instead of a body swap. The composed
 * path still holds the real anchor; Kit's own router reads it the same way.
 */
export function anchor_of(event: Event): HTMLAnchorElement | null {
	const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
	for (const n of path) {
		if (n instanceof Element && n.tagName === 'A') return n as HTMLAnchorElement;
	}
	const t = event.target;
	return t instanceof Element ? t.closest('a') : null;
}

function hovered_anchor(event: Event): HTMLAnchorElement | null {
	const t = event.target;
	if (!(t instanceof Element)) return null;
	const a = t.closest('a');
	if (a) return a as HTMLAnchorElement;
	return t.shadowRoot ? anchor_of(event) : null;
}

// @why SvelteKit's remote-function client patches `pushState` and `replaceState` on the history instance and warns when they are called (test: test/browser/router-claims.test.ts › the router writes history past a pushState and replaceState patched on the instance)
// oxlint-disable-next-line typescript/unbound-method -- the native method, kept before an instance patch; called with .call(history)
const native_push = typeof History !== 'undefined' ? History.prototype.pushState : null;
// oxlint-disable-next-line typescript/unbound-method -- the native method, kept before an instance patch; called with .call(history)
const native_replace = typeof History !== 'undefined' ? History.prototype.replaceState : null;
export const push_state = (state: unknown, url: string): void =>
	native_push ? native_push.call(history, state, '', url) : history.pushState(state, '', url);
export const replace_state = (state: unknown, url?: string): void => {
	if (native_replace)
		return url === undefined
			? native_replace.call(history, state, '')
			: native_replace.call(history, state, '', url);
	return url === undefined ? history.replaceState(state, '') : history.replaceState(state, '', url);
};

/** Resolved navigation target (URL + Kit-shaped stubs for params/route). */
export interface NavTarget {
	url: URL;
	params: Record<string, string>;
	route: { id: string | null };
}

/** Payload for {@link beforeNavigate} callbacks. */
export interface BeforeNavigation {
	from: NavTarget;
	to: NavTarget;
	type: string;
	cancel: () => void;
	willUnload: boolean;
}

/** Payload for {@link afterNavigate} callbacks. */
export interface AfterNavigation {
	from: NavTarget | null;
	to: NavTarget;
	type: string;
	willUnload: boolean;
}

/** Callback registered with {@link beforeNavigate}. */
export type BeforeNavigateCallback = (nav: BeforeNavigation) => void;
/** Callback registered with {@link afterNavigate}. */
export type AfterNavigateCallback = (nav: AfterNavigation) => void;

// @why Kit's `data-sveltekit-preload-*` grammar: eager, viewport, hover, tap, off or false, inherited from the nearest ancestor, an empty value meaning hover (test: apps/palaestra/e2e/prefetch.spec.ts › eager / hover / click-from-cache / off / tap / viewport all warm (or not) the page-HTML cache)
const PRELOAD_RANK: Record<string, number> = {
	eager: 0,
	viewport: 1,
	hover: 2,
	tap: 3,
	off: 4,
	false: 4
};
const PRELOAD_MARKED_ANCHORS = `[data-sveltekit-preload-data] a[href], [data-sveltekit-preload-code] a[href], a[href][data-sveltekit-preload-data], a[href][data-sveltekit-preload-code]`;

function hash_target_exists(hash: string): boolean {
	return fragment_is_top(hash) || !!fragment_target(hash);
}

/** Same document = pathname + search. Hash is not part of document identity. */
export function same_document(a: URL, b: URL): boolean {
	return a.pathname === b.pathname && a.search === b.search;
}

/**
 * Kit's `data-sveltekit-reload` grammar, nearest ancestor wins (Kit walks up from the anchor and
 * takes the first element that carries the attribute): `""` / `"true"` = full-page load, `"off"` /
 * `"false"` = SPA navigation — so a layout can opt a whole subtree OUT of the SPA and a child
 * subtree can opt back IN. Presence alone used to force a reload, which turned a
 * `data-sveltekit-reload="false"` subtree (an app's way of saying "SPA here") into full loads.
 * Across shadow roots: a link a web component renders in its own shadow tree sits under the page's
 * markup all the same (a card's link in a full-load subtree was swapped in place).
 */
export function reload_opt_out(anchor: Element): boolean {
	const v = nearest_attr(anchor, 'data-sveltekit-reload');
	return v !== null && v !== 'off' && v !== 'false';
}

/**
 * What a click on a link to the CURRENT document means. `hash`: a fragment jump — the browser's.
 * `swallow`: the navigation to this exact address is already in flight — a web-component link
 * (`<x-link>`, `<x-button href>`) handles the click itself and re-dispatches one on
 * its inner anchor; the router pushed the URL for the first click, so the second one looks like a
 * link to the current page — left to the browser it would RELOAD the document mid-swap. `refresh`:
 * a real click on a link to the page one is on — re-render in place (Kit re-runs the navigation
 * too; a full reload is never the answer for a same-origin link).
 */
export function same_document_link(
	url: URL,
	current: URL,
	in_flight: string | null
): 'hash' | 'swallow' | 'refresh' {
	if (url.hash && url.href !== current.href) return 'hash';
	if (in_flight === url.href) return 'swallow';
	return 'refresh';
}

export function document_key(url: URL): string {
	return url.pathname + url.search;
}

/** Instant scroll to a hash target (or top). Ignores CSS `scroll-behavior: smooth`. */
export function jump_to_hash(hash: string): void {
	const html_el = document.documentElement;
	const prev = html_el.style.scrollBehavior;
	html_el.style.scrollBehavior = 'auto';
	try {
		const el = fragment_target(hash);
		if (el) {
			el.scrollIntoView();
			return;
		}
		window.scrollTo(0, 0);
	} finally {
		html_el.style.scrollBehavior = prev;
	}
}

/** One entry of the visitor's history the router made (or took over): its address, and where the
 *  page was when the visitor left it: its scroll, and the id of the element that had focus. */
export interface HistoryEntry {
	readonly id: string;
	url: URL;
	scroll: { x: number; y: number } | null;
	focus: string | null;
}

/** How a navigation writes history: a new entry, the current one's address, or the entry a back or
 *  forward step is already on. */
export type HistoryMove = 'push' | 'replace' | 'pop';

function named(id: string): Record<string, unknown> {
	const kept = history.state as unknown;
	return kept !== null && typeof kept === 'object'
		? { ...(kept as Record<string, unknown>), ogygia: id }
		: { ogygia: id };
}

export class RouterHistory {
	/** Names this document's entries apart from another document's (a reload's, say). */
	readonly #doc = random.float().toString(36).slice(2, 10);
	#n = 0;
	readonly #entries = new Map<string, HistoryEntry>();
	#current: HistoryEntry | null = null;

	/** The entry of the page on screen, at the address bar's address while the browser is on it
	 *  (test/browser/router-history-address.test.ts). */
	get current(): HistoryEntry {
		const id = (history.state as { ogygia?: unknown } | null)?.ogygia;
		if (typeof id !== 'string') return (this.#current = this.adopt(new URL(location.href)));
		const entry = (this.#current ??= this.#add(new URL(location.href)));
		if (id === entry.id && entry.url.href !== location.href) entry.url = new URL(location.href);
		return entry;
	}

	/** Takes over the entry the browser is on as the router starts: its state names it now. */
	start(): void {
		replace_state(named(this.current.id));
	}

	/** The entry a history state names: this model's, `'foreign'` (another document's), or null
	 *  (no id: an entry the browser or the app made). */
	find(state: unknown): HistoryEntry | 'foreign' | null {
		const id = (state as { ogygia?: unknown } | null)?.ogygia;
		if (typeof id !== 'string') return null;
		return this.#entries.get(id) ?? (id.startsWith(`${this.#doc}.`) ? null : 'foreign');
	}

	/** The page on screen is being left: keep where it is. */
	leave(): void {
		const entry = this.current;
		entry.scroll = { x: scrollX, y: scrollY };
		const active = typeof document === 'undefined' ? null : document.activeElement;
		entry.focus = active && active !== document.body && active.id ? active.id : null;
	}

	/** A page goes in at `url` (the browser's entry is written now). `push`: a new entry after the
	 *  one left; `replace`: the current one at a new address; `pop`: `to`, the entry a back or
	 *  forward step is on. */
	commit(url: URL, move: HistoryMove, to?: HistoryEntry): HistoryEntry {
		if (move === 'push') {
			this.leave();
			const entry = this.#add(url);
			push_state({ ogygia: entry.id }, url.href);
			return (this.#current = entry);
		}
		const entry = move === 'pop' && to ? to : this.current;
		entry.url = url;
		this.#current = entry;
		if (location.href !== url.href || history.state?.ogygia !== entry.id)
			replace_state(named(entry.id), url.href);
		return entry;
	}

	/** The entry the browser stepped to, which no id names: this model's from now on. */
	adopt(url: URL): HistoryEntry {
		const entry = this.#add(url);
		replace_state(named(entry.id));
		return entry;
	}

	#add(url: URL): HistoryEntry {
		const entry: HistoryEntry = {
			id: `${this.#doc}.${++this.#n}`,
			url,
			scroll: null,
			focus: null
		};
		this.#entries.set(entry.id, entry);
		return entry;
	}
}

function on_idle(page: Scope, fn: () => void, cap = 1000) {
	const run = () => {
		idle();
		capped();
		fn();
	};
	const idle = page.timeout(run, 'idle');
	const capped = page.timeout(run, cap);
}

type Nav = typeof import('./router-nav.ts');
let loaded_nav: Nav | null = null;
const load_nav = flights({
	name: 'navigation',
	run: import_again(() => import('./router-nav.ts')),
	retry: download
});
function nav(): Promise<Nav | Stale> {
	slots.router_link ??= { jump_to_hash, fragment_target };
	return load_nav.get().then((m) => (m === STALE ? m : (loaded_nav = m)));
}

export class SpaRouter {
	#started = false;
	#before_hooks = new Set<BeforeNavigateCallback>();
	#after_hooks = new Set<AfterNavigateCallback>();
	/**
	 * THE NAVIGATION, one machine (./navigation.ts): idle, claimed (the click, while the navigation
	 * chunk loads), loading (its fetch through its swap), settling (swapped: the last steps run). A
	 * new click is a new visit, so whatever the old one still had in flight sees it is not current
	 * (`nav.now !== mine`) and stops, and its fetch is aborted. It was three fields kept by hand; two
	 * clicks during the first chunk load once held the same generation and the last one was lost.
	 */
	readonly nav: Navigation = create_navigation();

	/** href of the router's navigation in flight (claimed or loading; cleared once it applied,
	 *  ended, or went to the browser: `hand_off`) */
	get nav_target(): string | null {
		const s = this.nav.now;
		return s.kind === 'claimed' || s.kind === 'loading' ? s.href : null;
	}
	/**
	 * The anchors whose click the router took (prevented, and navigated), and the address it took each
	 * to. A link component clicks its inner `<a>` again after the visitor's click, and that second
	 * click may never reach the router's `document` listener: a click event that is not composed
	 * stays in the component's shadow tree, and an anchor the swap took out of the page is in no
	 * document. The browser then followed the link itself, a full load after a click the router had
	 * already prevented (#263). So an anchor the router took a click from listens itself, for the
	 * clicks `document` will not hear (`#on_anchor_click`).
	 */
	#taken = new WeakMap<HTMLAnchorElement, string>();
	/** The visitor's history, as the router keeps it (`RouterHistory`): the rest is read from it. */
	readonly history: RouterHistory = new RouterHistory();
	/**
	 * Full URL of the page on screen: its history entry's. `navigate()` uses this as its `from`
	 * instead of `location.href`, because on a `popstate` (back/forward) the browser has ALREADY
	 * changed `location` to the target — so `location.href` would equal the target and the
	 * same-document guard would wrongly bail into the hash-only branch, never swapping the body
	 * (browser back left the old page's DOM in place). POP-FROM.
	 */
	get current_url(): URL {
		return this.history.current.url;
	}
	/** pathname+search of the page on screen (hash ignored). */
	get doc_key(): string {
		return document_key(this.current_url);
	}

	beforeNavigate(fn: BeforeNavigateCallback): () => boolean {
		this.#before_hooks.add(fn);
		return () => this.#before_hooks.delete(fn);
	}

	afterNavigate(fn: AfterNavigateCallback): () => boolean {
		this.#after_hooks.add(fn);
		try {
			fn({
				from: null,
				to: this.#build_nav_target(new URL(location.href)),
				type: 'enter',
				willUnload: false
			});
		} catch (error) {
			report_thrown(error);
		}
		return () => this.#after_hooks.delete(fn);
	}

	/**
	 * Keep the document in the DOM: the navigation in flight (if any) never swaps. The document key
	 * moves only when a swap commits, so every "same document" decision is about the page still on
	 * screen — and one made while the next page loads (back to this page, a link to it) must cancel
	 * that load, or it lands under this page's address (back pressed before `/plain` finished
	 * swapping left the URL on the old page and `/plain` in the DOM).
	 */
	supersede(): void {
		if (this.nav.now.kind !== 'idle') this.nav.go('idle');
	}

	/**
	 * GIVE `visit`'s NAVIGATION TO THE BROWSER — a page the router will not render (a csr=true Kit
	 * page, a page that is not ogygia's, another build), or one it could not fetch or load its code
	 * for: a document navigation to `url`, from the document on screen (`from`).
	 *
	 * It ENDS the visit, on every path: from here on the navigation is the browser's, never the
	 * router's in flight. The browser may well keep this page on screen (a file download, a 204, a
	 * body it does not show), and then nothing else ends it: left `loading`, every later click on the
	 * link joined it and was swallowed (#266). A visit already left (a newer click took over, or back
	 * to the page on screen) hands nothing off: the browser never goes where the visitor no longer is.
	 *
	 * The router writes an entry only when a page goes in, so a click handed off has none: the
	 * browser's navigation is a new entry of its own, and one it keeps the page on screen for adds
	 * none (#297). A back or forward step is already on its entry, and a refresh on the one on
	 * screen: the browser's navigation REPLACES it, so its document holds the entry alone, never
	 * shares it with the router's page (back from a csr=true page then loads the router page, #259).
	 * So does a commit that failed after it wrote the entry (the address is already `url`).
	 *
	 * `error`: the navigation failed part way (its devalue did not load, its swap threw, #276). It
	 * is said (the page's error handler, as an uncaught throw would be), and the browser loads the
	 * page whole.
	 */
	hand_off(url: URL, visit: Navigation['now'], move: HistoryMove, error?: unknown): void {
		if (this.nav.now !== visit) return;
		this.nav.go('idle');
		if (error !== undefined) report_thrown(error);
		if (move === 'push' && location.href !== url.href) location.assign(url.href);
		else location.replace(url.href);
	}

	bust_page_cache(): void {
		loaded_nav?.bust_page_cache();
	}

	/** The page at `href`, or `null` when there is none to have: the fetch failed (./router-nav.ts
	 *  `fetch_page`), or the navigation code itself did not load. The prefetches (a hover, a
	 *  viewport link, `preloadData`) start it and never wait on it: a rejection here was uncaught. */
	fetch_page(
		href: string,
		signal?: AbortSignal,
		purpose?: 'nav' | 'prefetch' | 'history'
	): Promise<import('./router-nav.ts').FetchedPage | null> {
		return nav().then(
			(n) => (n === STALE ? null : n.fetch_page(href, signal, purpose)),
			() => null
		); // ok: the navigation chunk did not load: no page fetched, so the browser navigates (the chunk's load says its failure)
	}

	async navigate(
		url: URL,
		opts: {
			push?: boolean;
			/** the entry a back or forward step is on */
			pop?: HistoryEntry;
			type?: string;
			replace?: boolean;
		} = {}
	): Promise<void> {
		const { push = true, type = 'link', replace = false } = opts;
		const from = this.current_url;
		let move: HistoryMove = 'replace';
		if (opts.pop) move = 'pop';
		else if (push && !replace) move = 'push';

		if (same_document(url, from) && !replace) {
			if (!this.run_before(from, url, type)) return;
			this.supersede();
			if (url.href !== location.href) this.history.commit(url, move);
			jump_to_hash(url.hash);
			this.run_after(from, url, type);
			return;
		}

		if (!this.run_before(from, url, type)) return;

		this.nav.go('claimed', { href: url.href });
		const mine = this.nav.now;
		let n: Nav | null | Stale;
		try {
			n = await this.nav.scope.task(() => nav().then((c) => (c === STALE ? null : c)));
		} catch {
			return this.hand_off(url, mine, move);
		}
		if (n === STALE) return;
		if (n === null) return this.hand_off(url, mine, move);
		return n.navigate(this, url, from, opts, mine);
	}

	/** A URL it refuses (not http, another origin without `external`, unparsable) rejects the
	 *  promise, as Kit's goto does: async, so nothing throws out of the call. */
	async goto(
		url: string | URL,
		opts: { replaceState?: boolean; external?: boolean } = {}
	): Promise<void> {
		const target = new URL(url, location.href);
		if (target.protocol !== 'http:' && target.protocol !== 'https:') {
			throw new OgygiaError('goto_not_http');
		}
		if (target.origin !== location.origin) {
			if (opts.external) {
				location.assign(target.href);
				return;
			}
			throw new OgygiaError('goto_cross_origin');
		}
		return this.navigate(target, { push: !opts.replaceState, replace: false, type: 'goto' });
	}

	invalidateAll(): Promise<void> {
		return nav().then((n) => (n === STALE ? undefined : n.invalidate_all(this.current_url)));
	}

	invalidate(): Promise<void> {
		return this.invalidateAll();
	}

	preloadData(url: string | URL): Promise<{ type: string; status: number; data: {} }> {
		const target = new URL(url, location.href);
		if (target.origin !== location.origin)
			return Promise.resolve({ type: 'loaded', status: 200, data: {} });
		// oxlint-disable-next-line typescript/no-floating-promises -- a prefetch is never waited on, and fetch_page never rejects (a failure is null)
		this.fetch_page(target.href, undefined, 'prefetch');
		return Promise.resolve({ type: 'loaded', status: 200, data: {} });
	}

	preloadCode(): Promise<void> {
		return Promise.resolve();
	}

	disableScrollHandling(): void {
		if (typeof console !== 'undefined') {
			warn('scroll_handling_noop');
		}
	}

	pushState(): void {
		warn('shallow_routing_unsupported', { method: 'pushState' });
	}

	replaceState(): void {
		warn('shallow_routing_unsupported', { method: 'replaceState' });
	}

	start(): void {
		if (this.#started || typeof document === 'undefined') return;
		if (!document.querySelector('meta[name="ogygia-router"]')) return;
		if (kit_hydrates_page()) return;
		this.#started = true;
		this.history.start();
		if (RULES) watch_router(this);
		const body = document.body;
		if (body) record_server_body(body, body, Array.from(body.childNodes));

		// oxlint-disable-next-line ogygia/owned-effects -- the router's click delegation, installed once (`#started`): it lives as long as the document
		document.addEventListener('click', (event) => this.#on_click(event, anchor_of(event)));

		this.#install_prefetch();

		// oxlint-disable-next-line ogygia/owned-effects -- the router's back/forward, installed once (`#started`): it lives as long as the document
		window.addEventListener('popstate', () => {
			const url = new URL(location.href);
			const found = this.history.find(history.state);
			if (found === 'foreign') {
				this.supersede();
				location.reload();
				return;
			}
			const entry = found ?? this.history.adopt(url);
			// @why the browser restores the next entry's scroll after `popstate`, onto the page still on screen (test: apps/palaestra/e2e/router-history.spec.ts › #270 Forward after Back lands where the page was left)
			this.history.leave();
			if (document_key(url) === this.doc_key) {
				this.supersede();
				this.history.commit(url, 'pop', entry);
				return;
			}
			// oxlint-disable-next-line typescript/no-floating-promises -- an event starts the navigation and never waits; it settles on its own (a failed one hands off to the browser)
			this.navigate(url, { push: false, pop: entry, type: 'popstate' });
		});
	}

	/** A click on `anchor`: the router's, or the browser's. A click it prevents always ends in a
	 *  navigation, the one it starts or the one it joins. */
	#on_click(event: MouseEvent, anchor: HTMLAnchorElement | null): void {
		const url = this.#should_intercept(event, anchor);
		if (!url || !anchor) return;
		if (this.#joins(event, anchor, url)) {
			event.preventDefault();
			return;
		}
		if (same_document(url, new URL(location.href))) {
			const kind = same_document_link(url, new URL(location.href), this.nav_target);
			if (kind === 'hash') {
				// @why the browser scrolls to the top for a fragment no element has (test: apps/palaestra/e2e/router-history.spec.ts › #282 Back between two app-managed fragments keeps the scroll)
				if (!hash_target_exists(url.hash)) {
					event.preventDefault();
					if (location.hash !== url.hash) {
						const old = location.href;
						this.history.commit(url, 'push');
						window.dispatchEvent(
							new HashChangeEvent('hashchange', { oldURL: old, newURL: url.href })
						);
					}
				}
				return;
			}
			event.preventDefault();
			this.#take(anchor, url);
			// oxlint-disable-next-line typescript/no-floating-promises -- a click starts the navigation and never waits; it settles on its own (a failed one hands off to the browser)
			if (kind === 'refresh') this.navigate(url, { push: false, replace: true });
			return;
		}
		event.preventDefault();
		this.#take(anchor, url);
		// oxlint-disable-next-line typescript/no-floating-promises -- a click starts the navigation and never waits; it settles on its own (a failed one hands off to the browser)
		this.navigate(url, { push: true });
	}

	/**
	 * Does this click join a navigation the router already has? Its own in flight to the click's
	 * address (a double click, or a link component re-dispatching the visitor's click on its inner
	 * `<a>`): never one it gave the browser (`hand_off` ends that visit), so a link to a download is
	 * a new navigation each time; or
	 * the one this very anchor started, to the page now on screen, when the click is a re-dispatch
	 * (untrusted: the component's, never the visitor's — a visitor's click on a link to the page they
	 * are on refreshes it).
	 */
	#joins(event: MouseEvent, anchor: HTMLAnchorElement, url: URL): boolean {
		if (this.nav_target === url.href) return true;
		return (
			!event.isTrusted &&
			this.#taken.get(anchor) === url.href &&
			same_document(url, this.current_url)
		);
	}

	/** The router took a click on `anchor` to `url`: from now on the anchor hears its own clicks too. */
	#take(anchor: HTMLAnchorElement, url: URL): void {
		if (!this.#taken.has(anchor)) {
			// oxlint-disable-next-line ogygia/owned-effects -- the anchor's own, for its life: a kept anchor needs it on the next page too, an anchor in no region hears it as well, and it goes with the anchor (nothing else holds it: `#taken` is weak)
			anchor.addEventListener('click', (event) => this.#on_anchor_click(event, anchor));
		}
		this.#taken.set(anchor, url.href);
	}

	/**
	 * A click on an anchor the router took a click from, heard on the anchor itself. One that reaches
	 * `document` is the document listener's (a component on the way may still prevent it); one that
	 * cannot — not composed and inside a shadow tree, or on an anchor that is in no document — is
	 * handled here, the same way.
	 */
	#on_anchor_click(event: MouseEvent, anchor: HTMLAnchorElement): void {
		const reaches_document =
			anchor.isConnected && (event.composed || anchor.getRootNode() === document);
		if (!reaches_document) this.#on_click(event, anchor);
	}

	#should_intercept(event: MouseEvent, anchor: HTMLAnchorElement | null) {
		if (event.defaultPrevented) return false;
		if (event.button !== 0) return false;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
		if (!anchor || !anchor.href) return false;
		if (anchor.target && anchor.target !== '_self') return false;
		if (anchor.hasAttribute('download')) return false;
		if (anchor.hasAttribute('data-no-spa')) return false;
		if (reload_opt_out(anchor)) return false;
		const rel = (anchor.getAttribute('rel') || '').split(WS);
		if (rel.includes('external')) return false;
		const url = new URL(anchor.href);
		if (url.origin !== location.origin) return false;
		return url;
	}

	run_before(from: URL, to: URL, type: string): boolean {
		let cancelled = false;
		const nav = {
			from: this.#build_nav_target(from),
			to: this.#build_nav_target(to),
			type,
			cancel: () => (cancelled = true),
			willUnload: false
		};
		for (const fn of this.#before_hooks) {
			try {
				fn(nav);
			} catch (error) {
				report_thrown(error);
			}
		}
		return !cancelled;
	}

	run_after(from: URL, to: URL, type: string): void {
		for (const fn of this.#after_hooks) {
			try {
				fn({
					from: this.#build_nav_target(from),
					to: this.#build_nav_target(to),
					type,
					willUnload: false
				});
			} catch (error) {
				report_thrown(error);
			}
		}
	}

	#install_prefetch() {
		// oxlint-disable-next-line ogygia/owned-effects -- the router's hover delegation, installed once at start: it lives as long as the document
		document.addEventListener(
			'mouseover',
			(event) => {
				const anchor = hovered_anchor(event);
				if (anchor && this.#preload_rank(anchor) <= PRELOAD_RANK.hover) this.#warm_anchor(anchor);
			},
			{ passive: true }
		);
		const on_press = (event: Event) => {
			const anchor = anchor_of(event);
			if (anchor && this.#preload_rank(anchor) <= PRELOAD_RANK.tap) this.#warm_anchor(anchor);
		};
		// oxlint-disable-next-line ogygia/owned-effects -- the router's press delegation, installed once at start: it lives as long as the document
		document.addEventListener('mousedown', on_press, { passive: true });
		// oxlint-disable-next-line ogygia/owned-effects -- the router's press delegation, installed once at start: it lives as long as the document
		document.addEventListener('touchstart', on_press, { passive: true });

		this.scan_preload_links();
	}

	/**
	 * After start + every navigation, in IDLE: eager links warm now; viewport links get observed.
	 * Only anchors under a preload-marked element are read — an unmarked anchor has no trigger. Idle,
	 * because the scan competes with the freshly swapped page's own islands for the main thread and
	 * a warm is speculation by definition. The scan and its watches are the page visit's
	 * (./session.ts `PageVisit`): the next page's swap ends them, so the anchors of a page left
	 * behind are never held, and a scan still waiting for idle time when its page is left never runs.
	 * "On screen" is the one viewport tracker's (./viewport.ts), as for a region's `visible` wake.
	 */
	scan_preload_links(): void {
		const page = runtime_session.visit.scope;
		on_idle(page, () => {
			for (const anchor of Array.from(document.querySelectorAll(PRELOAD_MARKED_ANCHORS))) {
				const rank = this.#preload_rank(anchor);
				if (rank === PRELOAD_RANK.eager) this.#warm_anchor(anchor);
				else if (rank === PRELOAD_RANK.viewport)
					page.defer(once_on_screen(anchor, '0px', () => this.#warm_anchor(anchor)));
			}
		});
	}

	/** Warm the page-HTML cache for an anchor if it's a same-origin SPA target. */
	#warm_anchor(anchor: Element) {
		const url = this.#should_intercept(
			{ button: 0, defaultPrevented: false } as MouseEvent,
			anchor as HTMLAnchorElement
		);
		if (!url) return;
		if (same_document(url, new URL(location.href))) return;
		// oxlint-disable-next-line typescript/no-floating-promises -- a warm is never waited on, and fetch_page never rejects (a failure is null)
		if (url.href !== location.href) this.fetch_page(url.href, undefined, 'prefetch');
	}

	/** Rank of the most-eager preload trigger that applies to `anchor` (5 = none). */
	#preload_rank(anchor: Element): number {
		let rank = 5;
		const d = this.#preload_attr(anchor, 'data-sveltekit-preload-data');
		const c = this.#preload_attr(anchor, 'data-sveltekit-preload-code');
		if (d != null) rank = Math.min(rank, PRELOAD_RANK[d] ?? 5);
		if (c != null) rank = Math.min(rank, PRELOAD_RANK[c] ?? 5);
		return rank;
	}

	/** Nearest-ancestor value of `name` (Kit inheritance); empty value -> 'hover'. null if unset. */
	#preload_attr(el: Element, name: string): string | null {
		const holder = el.closest(`[${name}]`);
		if (!holder) return null;
		const v = holder.getAttribute(name);
		return v === '' || v == null ? 'hover' : v;
	}

	#build_nav_target(url: URL): NavTarget {
		return { url, params: {}, route: { id: null } };
	}
}

const spa = new SpaRouter();

/**
 * Register a callback before a client-side navigation.
 * Call `nav.cancel()` to abort. Returns an unsubscribe function. Inside a component, prefer the
 * `$app/navigation` / `ogygia/app` export, which unsubscribes on destroy.
 */
export function beforeNavigate(fn: BeforeNavigateCallback): () => boolean {
	return spa.beforeNavigate(fn);
}

/**
 * Register a callback after a successful client-side navigation.
 * Returns an unsubscribe function. Inside a component, prefer the `$app/navigation` /
 * `ogygia/app` export, which unsubscribes on destroy.
 */
export function afterNavigate(fn: AfterNavigateCallback): () => boolean {
	return spa.afterNavigate(fn);
}

/** Drop all warmed page HTML (call after mutations / auth changes). */
export function bust_page_cache(): void {
	spa.bust_page_cache();
}

/**
 * Programmatic same-origin navigation. Mirrors Kit's `goto()` subset.
 * @param url - Absolute or relative URL (http(s) only).
 * @param opts.replaceState - Replace the current history entry instead of pushing.
 */
export function goto(url: string | URL, opts: { replaceState?: boolean } = {}): Promise<void> {
	return spa.goto(url, opts);
}

/**
 * Soft-refresh the current URL's document seeds + head (not a navigation).
 * Busts the SPA HTML cache so the next real route change is fresh. Coarser than
 * Kit's dependency-scoped invalidate — see `invalidate_all` in ./router-nav.ts.
 */
export function invalidateAll(): Promise<void> {
	return spa.invalidateAll();
}

/**
 * Refresh navigation data. Without Kit's client we cannot invalidate a single
 * dependency, so this refreshes everything (same as {@link invalidateAll}).
 */
export function invalidate(): Promise<void> {
	return spa.invalidate();
}

/**
 * Warm the next page: fetch it into the swap-readable HTML cache (+ its island modules) — this is
 * what makes the eventual click instant, and no browser cache can feed a body swap. (Router OFF —
 * the browser owns navigation — is the MPA navigation handle's Speculation Rules hint, not this
 * module: ./nav-handle.ts. This module only loads with the router feature.)
 */
export function preloadData(
	url: string | URL
): Promise<{ type: string; status: number; data: {} }> {
	return spa.preloadData(url);
}

/** No-op with the router on: page “code” arrives with the HTML body swap (+ island chunks on
 *  connect). Router OFF is the MPA navigation handle's prefetch hint (./nav-handle.ts). */
export function preloadCode(_url?: string | URL): Promise<void> {
	return spa.preloadCode();
}

/** Skip scroll restoration / scroll-to-top on the next client-side navigation. */
export function disableScrollHandling(): void {
	spa.disableScrollHandling();
}

/**
 * Shallow routing is not supported without Kit's client runtime.
 * @throws Always — use full navigations instead.
 */
export function pushState(): void {
	spa.pushState();
}

/**
 * Shallow routing is not supported without Kit's client runtime.
 * @throws Always — use full navigations instead.
 */
export function replaceState(): void {
	spa.replaceState();
}

/**
 * Install click/popstate listeners and start SPA navigation.
 * Invoked by the runtime once the module loads (handle-injected on every ogygia page, or by an island).
 * @internal
 */
export function startRouter(): void {
	spa.start();
}

/**
 * Feature entry: start the SPA router once the DOM is ready, but only when the page carries
 * `<meta name="ogygia-router">` (the handle injects it globally unless `ogygia({ router: false })`)
 * and Kit is not already booting it.
 */
export function install(): void {
	if (typeof document === 'undefined') return;
	slots.nav = { goto, invalidateAll };
	publish_nav({
		goto,
		invalidate,
		invalidateAll,
		preloadData,
		preloadCode,
		disableScrollHandling,
		pushState,
		replaceState,
		beforeNavigate,
		afterNavigate,
		bust_page_cache
	});
	const start = () => {
		if (!document.querySelector('meta[name="ogygia-router"]')) return;
		if (kit_hydrates_page()) return;
		startRouter();
		document.dispatchEvent(new Event('og:page-load'));
	};
	if (document.readyState === 'loading') {
		// oxlint-disable-next-line ogygia/owned-effects -- the router's start, once, when the document is parsed: the document's own event
		document.addEventListener('DOMContentLoaded', start, { once: true });
	} else {
		start();
	}
}
