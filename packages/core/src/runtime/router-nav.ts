/**
 * THE NAVIGATION — the router's heavy half, loaded lazily by ./router.ts on the first prefetch or
 * intercepted click: page fetch + cache, head merge, the body reconcile / morph, seeds, a11y.
 * Nothing here runs at boot; a visitor who never leaves the page never downloads it.
 *
 * A navigation is a STAGED CHANGE (`stage`, @ogygia/machine), in two tasks. The build — this
 * module's `navigate` up to the commit — does everything that needs no live DOM change: fetch and
 * parse the HTML, read the route facts, batch the incoming holes, stamp reconcile keys, parse the
 * incoming page seed, drop hints for modules already warm, load the stylesheets (inert: they style
 * nothing yet). Then it yields. The commit is one synchronous step, the view transition's callback
 * or a plain call, and does ONLY the DOM: head merge, seeds, body morph, title. A navigation left
 * before its commit gives back what it built; one whose commit throws goes to the browser. The old
 * single-task swap ran a whole-document regex, two `'*'` walks and a seed parse inside
 * `startViewTransition`, on the frame the transition captures. The soft refresh is staged the same
 * way.
 */
import { boot_link, router_link, slots } from './slots.ts';
import { clock, net } from '@ogygia/machine';
import type { PageGlobals } from '../page-globals.ts';
import {
	opts_out_of_reconcile,
	reconcile_body,
	stamp_region_keys,
	swap_body
} from './reconcile.ts';
import {
	apply_soft_invalidate_doc,
	finish_spa_document,
	page_seed_of,
	prepare_spa_document
} from './seeds.ts';
import type { HistoryEntry, HistoryMove, SpaRouter } from './router.ts';
import { spa_html_cacheable } from './spa-cacheable.ts';
import { is_dangerous_head_node } from './head-deny.ts';
import { pin_region_urls } from './entry-locations.ts';
import { emit as dt_emit } from '../events/bus.ts';
import {
	OG_FP,
	OG_LATE,
	OG_LOCATIONS,
	OG_OWNER,
	OG_SLOT,
	OGYGIA_ANNOUNCER,
	OGYGIA_DEV_HMR,
	OGYGIA_GRAPH,
	OGYGIA_KEEP,
	OGYGIA_REGION_CSS,
	OGYGIA_RUNTIME,
	tags,
	text_of
} from '../wire-markup.ts';
import { KNOWN_HEADER_CAP } from '../contract/known-copies.ts';

// What this lazy chunk uses from the boot and from the router, handed over through the registry — it
// never imports a boot module (./slots.ts `BootLink`: a module both import is split out of the runtime
// chunk). The router's helpers exist only with the router feature; the MPA `invalidateAll` path (no
// router) touches none of them.
// (rules on: `rule_head_adopted` checks the head with this chunk's own deny, ./rules.ts)
(globalThis as PageGlobals).__og_head_deny?.(is_dangerous_head_node);

const KitBoot = { document_has: (doc: ParentNode) => boot_link().KitBoot.document_has(doc) };
const regions_in_shadow = () => boot_link().regions_in_shadow();
const release_head_nodes = (unlisted: readonly Element[]) =>
	boot_link().release_head_nodes(unlisted);
const head_owners = (node: Element) => boot_link().head_owners(node);
const add_head_owners = (node: Element, more: Iterable<string>) =>
	boot_link().add_head_owners(node, more);
const adopt_owner_record = (doc: ParentNode, head: ParentNode) =>
	boot_link().adopt_owner_record(doc, head);
const session = () => boot_link().runtime_session;
const adopt_response = (next: Document) => boot_link().adopt_response(next);
type Scope = import('@ogygia/machine').Scope;
type Stale = import('@ogygia/machine').Stale;
type Staging = import('@ogygia/machine').Staging;
/** devalue first, when the fetched page holds a script in its lane (./devalue-lane.ts) */
const devalue_for = (doc: Document) =>
	boot_link().needs_devalue(doc) ? boot_link().load_devalue() : undefined;
const is_warmed_module = (entry: string, base?: string) =>
	boot_link().is_warmed_module(entry, base);
const warm_island_module = (entry: string, base?: string) =>
	boot_link().warm_island_module(entry, base);
const runs_entry = (attrs: import('./region-attrs.ts').RegionAttrs) =>
	boot_link().runs_entry(attrs);
const note_entry_location = (entry: string, src: string | null, base?: string) =>
	boot_link().note_entry_location(entry, src, base);
const register_island_graph = (text: string, base: string) =>
	boot_link().register_island_graph(text, base);
const yield_task = () => boot_link().yield_task();
/** What a machine's task answers once its visit is left (the boot's `@ogygia/machine`). */
const is_stale = (v: unknown): v is Stale => v === boot_link().STALE;
const jump_to_hash = (hash: string) => router_link().jump_to_hash(hash);

// DEVTOOLS gate — module-local const from the Vite `define` (proven DCE pattern); off → folds out.
const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const HOOK_NAVIGATED =
	typeof __OGYGIA_HOOK_NAVIGATED__ !== 'undefined' ? __OGYGIA_HOOK_NAVIGATED__ : true;
const HOOK_NAV_STARTED =
	typeof __OGYGIA_HOOK_NAV_STARTED__ !== 'undefined' ? __OGYGIA_HOOK_NAV_STARTED__ : true;
/** The monotonic clock, for devtools nav timings (dead when off). */
const dt_now = clock.mono;

/** RECONCILER R1: when on (and morph is installed), a nav diffs the body IN PLACE — matched regions
 *  keep their live islands, changed regions re-mount, the shell morphs — instead of a full-body
 *  replaceWith. Flip to `false` to fall back to the legacy full-swap path (the e2e safety net). */
const RECONCILE_NAV = true;

/** SERVER-DELTA NAV is OPT-IN for the first release (a new client↔server protocol). Off → the client
 *  never sends `x-ogygia-known`, so `reuse_known_region()` never skips server-side and every region
 *  full-renders (the documented safe fallback). Compile-time constant (Vite `define`); typeof-guarded
 *  so a plain node import of dist/ without the define falls back to OFF. */
const SERVER_DELTA =
	typeof __OGYGIA_SERVER_DELTA__ !== 'undefined' ? __OGYGIA_SERVER_DELTA__ : false;

/**
 * Why a page fetch is happening — sent to the server so it can skip side effects a speculative or
 * restorative fetch must not fire (analytics beacons, "last seen" writes, one-time banners):
 *  • `nav`      — a real, user-driven navigation (default). No purpose header.
 *  • `prefetch` — warmed on hover / press / viewport, BEFORE any intent to visit. Marked so the
 *                 server can treat it as a dry run (htmx's `HX-Preloaded`).
 *  • `history`  — a back/forward restore, re-fetched because we snapshot no DOM (htmx's
 *                 `HX-History-Restore-Request`). The visitor has seen this page already.
 * The header is advisory: a server that ignores it still renders correctly.
 */
export type NavPurpose = 'nav' | 'prefetch' | 'history';

/** The `Accept` a browser sends for a top-level document navigation (Chromium's value). */
export const DOCUMENT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/**
 * The live region copies the server may skip (#846): one fingerprint per copy, so twins repeat it.
 * The server skips the first copies of a fingerprint in document order, and the morph pairs each
 * skipped placeholder with the live copy of the same place (runtime/reconcile.ts keys the n-th copy
 * of an identity `<identity> <n>`). So a fingerprint's copies are claimed only up to the first one
 * not hydrated: a placeholder paired with a copy that is still server markup would empty it.
 */
function known_copies(doc: Document): string[] {
	const out: string[] = [];
	/** Fingerprints whose run of hydrated copies ended. */
	const ended = new Set<string>();
	for (const el of doc.querySelectorAll(`ogygia-region[${OG_FP}]`)) {
		const fp = el.getAttribute(OG_FP);
		if (!fp || ended.has(fp)) continue;
		if (el.hasAttribute('data-hydrated')) out.push(fp);
		else ended.add(fp);
	}
	return out;
}

/**
 * SERVER-DELTA NAV (D2): headers for a nav/prefetch fetch. Always `x-ogygia-spa`. When `purpose` is
 * not a plain nav, `x-ogygia-purpose` names it (see {@link NavPurpose}). Plus, when the current
 * document has HYDRATED islands carrying a `data-og-fp`, `x-ogygia-known` lists their fingerprints, one
 * per live copy ({@link known_copies}), so the server can SKIP re-rendering as many copies as this page
 * already has live. Only data-hydrated regions
 * are claimed (never assert a region we don't actually have), and the header is omitted past a size
 * cap → the server renders everything (progressive enhancement: every header here is an optimization
 * the server may ignore, and its absence is always correct).
 */
function nav_headers(purpose: NavPurpose = 'nav'): Record<string, string> {
	// The page is fetched the way the browser fetches a DOCUMENT: `fetch` alone sends `Accept: */*`,
	// and servers answer that differently from a navigation (an app on the field answered `*/*` with
	// a 302 home and `text/html` with its 404 page) — error pages, page-vs-API routing, auth and CDN
	// rules all key on it. The router must land where a real navigation would.
	const headers: Record<string, string> = { accept: DOCUMENT_ACCEPT, 'x-ogygia-spa': '1' };
	if (purpose !== 'nav') headers['x-ogygia-purpose'] = purpose;
	if (!SERVER_DELTA || typeof document === 'undefined') return headers;
	const live = known_copies(document);
	if (live.length === 0) return headers;
	const joined = live.join(',');
	if (joined.length <= KNOWN_HEADER_CAP) headers['x-ogygia-known'] = joined;
	return headers;
}

/**
 * Fold ORPHANED `view-transition-name`s into the page-level cross-fade. A name promotes its element
 * to a standalone transition group, LIFTED OUT of the root snapshot. When the element has no
 * counterpart on the other page — a sidebar full of named nav rows navigating to a marketing page
 * that has none — each one runs a solo enter/exit AND leaves a hole in the root cross-fade: a visible
 * stutter, worst in dev where the destination paints late. Names present on BOTH pages (the docs↔docs
 * active-highlight slide) are KEPT, so matched animations still play. Only INLINE names are touched
 * (nav rows carry theirs inline; the single CSS-set highlight chip is left alone). Returns a restore
 * fn to re-apply the stripped names AFTER the transition, so a page entered across a shell change
 * still animates on its next same-shell nav.
 */
function fold_orphan_vt_names(current: ParentNode, incoming: ParentNode): () => void {
	const names_in = (root: ParentNode): Map<string, HTMLElement[]> => {
		const map = new Map<string, HTMLElement[]>();
		for (const el of root.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')) {
			const n = el.style.getPropertyValue('view-transition-name').trim();
			if (!n || n === 'none') continue;
			let arr = map.get(n);
			if (!arr) map.set(n, (arr = []));
			arr.push(el);
		}
		return map;
	};
	const cur = names_in(current);
	const inc = names_in(incoming);
	const stripped: Array<[HTMLElement, string]> = [];
	const fold = (map: Map<string, HTMLElement[]>, other: Map<string, HTMLElement[]>) => {
		for (const [name, els] of map) {
			if (other.has(name)) continue; // matched on both pages — keep (the slide)
			for (const el of els) {
				stripped.push([el, name]);
				el.style.setProperty('view-transition-name', 'none');
			}
		}
	};
	fold(cur, inc); // current-only (docs→marketing): fold into the root exit
	fold(inc, cur); // incoming-only (marketing→docs): fold into the root enter
	return () => {
		for (const [el, name] of stripped) el.style.setProperty('view-transition-name', name);
	};
}

const PREFETCH_TTL_MS = 8_000;
const PAGE_CACHE_MAX_ENTRIES = 32;
const PAGE_CACHE_MAX_BYTES = 4_000_000; // ~4MB of UTF-16-ish HTML
/** Cap on waiting for a destination stylesheet to load before the body swap (cold-cache FOUC guard). */
const STYLESHEET_WAIT_MS = 2_000;
/** A `Content-Disposition` that makes a response a file to save. */
const ATTACHMENT = /^\s*attachment\b/i;
/** Kit remote-function POSTs live under `…/_app/remote/…` (or custom `appDir`). */
const REMOTE_MUTATION_PATH = /\/remote(?:\/|$|\?)/;

/** The address each of the page's live head nodes was written for, noted before the address moves
 *  (`own_live_head`). A fetched page's nodes need none: they are made absolute (`resolve_head_urls`). */
const WRITTEN_FOR = new WeakMap<Element, string>();

/** A node's URL attribute as the address it names: resolved against the page the node came from
 *  (a live node of the page: the address it was written for, not the one a navigation moved to
 *  since, #821; a fetched page's: its own address, set by `resolve_head_urls`). The live head's URLs
 *  are read this way, never rewritten (`own_live_head`). `../a.css` on `/x/y` and `/a.css` are one
 *  file, so one key. Empty when absent. */
function url_of(node: Element, attr: string): string {
	const value = node.getAttribute(attr);
	if (!value) return '';
	// (the map first: a node never noted, like a fetched page's or one keyed off the page, reads no document)
	const written = WRITTEN_FOR.get(node);
	const base =
		(written !== undefined && node.parentNode === document.head && written) || node.baseURI;
	try {
		return new URL(value, base).href;
	} catch {
		return value; // ok: not a URL: compared as written
	}
}

/** The head attributes that hold URLs, each fetched by the browser once a node is in the page. */
const HEAD_URL_ATTRS = ['href', 'src'] as const;
/** The head attributes that hold candidate lists (`url descriptor, url descriptor`). */
const HEAD_SRCSET_ATTRS = ['imagesrcset', 'srcset'] as const;

/**
 * A fetched page's head URLs belong to ITS address (#449). Kit links a page's assets page-relative
 * (`../../_app/immutable/assets/x.css`), and the next page's nodes go into the live document while
 * the address bar still shows the page being left: its sheets are loaded before the commit (#267,
 * #325). Copied as written, each resolved against the page on screen. Every URL of the parsed head
 * is made absolute against `page` once, right after the parse, so every copy of a node (staged,
 * merged) names the file its page means.
 */
export function resolve_head_urls(head: HTMLHeadElement, page: URL): void {
	for (const el of head.querySelectorAll('[href],[src],[imagesrcset],[srcset]')) {
		for (const attr of HEAD_URL_ATTRS) {
			const value = el.getAttribute(attr);
			// (an empty one names no file: the browser ignores it; resolved, it would name the page)
			if (value === null || value.trim() === '') continue;
			const resolved = page_relative_resolved(value, page);
			if (resolved !== value) el.setAttribute(attr, resolved);
		}
		for (const attr of HEAD_SRCSET_ATTRS) {
			const value = el.getAttribute(attr);
			if (value === null || value.trim() === '') continue;
			// (only a change is written: a live node's set again would be fetched again)
			const resolved = resolve_srcset(value, page);
			if (resolved !== value) el.setAttribute(attr, resolved);
		}
	}
}

/**
 * The page on screen, `page`, owns its live head nodes' URLs (#821, #1071): each node the page holds
 * is noted with the address it was written for, while the address is still that one, so the merge
 * reads it right after the address moves (`url_of`). The URLs stay as written: setting a fetched
 * node's URL again, even to the same file, fetches it again (a loaded sheet fires `load` again in
 * all three engines: nav-head-key-depth.test.ts). The one exception is a PARKED sheet (a disabled
 * stylesheet link): the browser has not fetched it, and fetches it once something turns it on,
 * under the address of that moment. So it alone is made absolute now.
 */
function own_live_head(page: URL): void {
	const owned = session().page_head;
	for (const el of document.head.children) {
		if (!owned.has(el) || WRITTEN_FOR.has(el)) continue; // (not ours, or noted already)
		WRITTEN_FOR.set(el, page.href);
		if (el.localName !== 'link' || !(el as HTMLLinkElement).disabled) continue;
		if (!/(?:^|\s)stylesheet(?:\s|$)/i.test(el.getAttribute('rel') ?? '')) continue;
		const value = el.getAttribute('href');
		if (value === null || value.trim() === '') continue;
		const resolved = page_relative_resolved(value, page);
		if (resolved !== value) el.setAttribute('href', resolved);
	}
}

/** A candidate list (`a.png 1x, b.png 2x`) with each URL resolved against `page`. */
function resolve_srcset(value: string, page: URL): string {
	// Read as the HTML spec reads a srcset: a comma separates candidates only between them (after
	// whitespace, or at the end of a URL); a comma inside a URL is the URL's (an image CDN's
	// transform path, a data: URL).
	const out: string[] = [];
	const space = (c: number) => c <= 32;
	let i = 0;
	while (i < value.length) {
		while (i < value.length && (space(value.charCodeAt(i)) || value[i] === ',')) i++;
		if (i >= value.length) break;
		const start = i;
		while (i < value.length && !space(value.charCodeAt(i))) i++;
		let url = value.slice(start, i);
		let descriptor = '';
		if (url.endsWith(',')) url = url.replace(/,+$/, '');
		else {
			const from = i;
			while (i < value.length && value[i] !== ',') i++;
			descriptor = value.slice(from, i).trim();
		}
		const resolved = page_relative_resolved(url, page);
		out.push(descriptor ? `${resolved} ${descriptor}` : resolved);
	}
	return out.join(', ');
}

/** Only a page-relative URL names a different file on another page: a root-relative (`/x`),
 *  protocol-relative (`//x`) or absolute one names the same file anywhere. */
const NOT_PAGE_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/)/i;

/**
 * `value` resolved against `page` when it is page-relative, written root-relative on this origin
 * (`../../_app/x.css` on `/a/e/` → `/_app/x.css`), so a node keeps the form the app's own selectors
 * and the head merge expect; anything else as written.
 */
function page_relative_resolved(value: string, page: URL): string {
	if (NOT_PAGE_RELATIVE.test(value)) return value;
	try {
		const url = new URL(value, page);
		return url.origin === location.origin ? url.pathname + url.search + url.hash : url.href;
	} catch {
		return value; // ok: not a URL (left as written: the browser ignores it the same way on either page)
	}
}

/** Stable-ish head node identity without serializing full outerHTML when possible. */
export function head_node_key(node: Element): string {
	const tag = node.tagName;
	switch (tag) {
		case 'TITLE':
			return 'TITLE';
		case 'META': {
			const charset = node.getAttribute('charset');
			if (charset != null) return 'META:charset';
			const http_equiv = node.getAttribute('http-equiv');
			if (http_equiv) return `META:http:${http_equiv}:${node.getAttribute('content') || ''}`;
			const name = node.getAttribute('name') || node.getAttribute('property') || '';
			if (name) return `META:${name}:${node.getAttribute('content') || ''}`;
			return `META:${node.outerHTML}`;
		}
		case 'LINK':
			return `LINK:${node.getAttribute('rel') || ''}:${url_of(node, 'href')}:${node.getAttribute('as') || ''}`;
		case 'SCRIPT': {
			const src = url_of(node, 'src');
			if (src) return `SCRIPT:src:${src}:${node.getAttribute('type') || ''}`;
			const type = node.getAttribute('type') || '';
			const text = node.textContent || '';
			return `SCRIPT:inline:${type}:${text.length}:${text.slice(0, 48)}`;
		}
		case 'STYLE': {
			// Kit's FOUC bag is one per document — key by role so SPA swaps replace it
			// instead of stacking length-prefixed duplicates or keeping a stale bag.
			if (node.hasAttribute('data-sveltekit')) return 'STYLE:data-sveltekit';
			// An INLINED region sheet (server/region-css.ts): keyed by the href it stands for, so
			// the same sheet on the next document is one node, kept, never stacked.
			const region_css = node.getAttribute(OGYGIA_REGION_CSS);
			if (region_css) return `STYLE:og-css:${region_css}`;
			const vite_id = node.getAttribute('data-vite-dev-id');
			if (vite_id) return `STYLE:vite:${vite_id}`;
			const text = node.textContent || '';
			return `STYLE:${text.length}:${text.slice(0, 48)}`;
		}
		default:
			return `${tag}:${node.outerHTML}`;
	}
}

/**
 * Head nodes that must survive SPA swaps even when absent from the next SSR head.
 * @internal
 */
export function keep_head_node_across_spa(node: Element): boolean {
	if (
		node.tagName === 'SCRIPT' &&
		node.getAttribute('type') === 'module' &&
		(node.hasAttribute(OGYGIA_RUNTIME) || node.hasAttribute(OGYGIA_DEV_HMR))
	) {
		return true;
	}
	// Vite soft-HMR CSS injections — not present in SSR HTML; dropping them blanks
	// styles that only lived in the client graph after the FOUC bag was replaced.
	if (node.tagName === 'STYLE' && node.hasAttribute('data-vite-dev-id')) return true;
	if (
		node.tagName === 'LINK' &&
		node.getAttribute('rel') === 'stylesheet' &&
		node.hasAttribute('data-vite-dev-id')
	) {
		return true;
	}
	return false;
}

/**
 * Install a `<style>` into the live document. `cloneNode` from a `DOMParser` tree
 * often fails to register the sheet; recreate with textContent instead.
 * @internal
 */
export function install_head_style(
	source: Element,
	head: HTMLHeadElement = document.head,
	before: Node | null = null
): HTMLStyleElement {
	const el = document.createElement('style');
	for (const attr of Array.from(source.attributes)) {
		el.setAttribute(attr.name, attr.value);
	}
	el.textContent = source.textContent || '';
	session().claim_page_head(el); // every caller installs the page's sheet (runtime/session.ts)
	head.insertBefore(el, before);
	return el;
}

/** Apply STREAMED-page late chunks after an SPA body swap: move each inert
 *  `<template data-og-late>` into its `og-late-slot` (stylesheets hoisted first via the same
 *  keyed head installer, so the swap never paints unstyled). On a full load the inline boot
 *  script in the streamed head does this progressively during parse — this is the swap-path
 *  twin. Islands inside the adopted content are custom elements: they connect and wake alone. */
export function apply_late_templates(root: ParentNode): void {
	for (const tpl of Array.from(root.querySelectorAll(`template[${OG_LATE}]`))) {
		const id = tpl.getAttribute(OG_LATE) ?? '';
		const slot = document.querySelector(`og-late-slot[${OG_SLOT}="${CSS.escape(id)}"]`);
		if (slot) {
			const content = (tpl as HTMLTemplateElement).content;
			for (const sheet of Array.from(content.querySelectorAll('link[rel="stylesheet"], style'))) {
				install_head_style(sheet);
			}
			slot.replaceChildren(content);
		}
		tpl.remove();
	}
}

/**
 * Move keyboard focus to `el` without scrolling (so it never fights the post-nav scroll restore),
 * making it momentarily focusable via `tabindex=-1` and then cleaning that up so the target does not
 * linger in the tab order. For `<body>` the attribute is removed immediately (body stays the active
 * element regardless). For a normal element — a `#hash` heading — removing `tabindex` while it is
 * focused would BLUR it back to `<body>`, so the cleanup is deferred to the element's next `blur`.
 *
 * The `tabindex` is LENT until that blur (`lent`), once per element: a second navigation that
 * focuses it meanwhile (a refresh in place at its `#hash`) finds the loan and leaves it, instead of
 * saving the first one's `-1` as the element's own and putting that back after the first cleanup
 * (#278). The loan is the element's, not the page's: an element kept across a navigation (inside a
 * kept island) still gives its `tabindex` back when focus leaves it on the next page.
 */
function focus_reset(el: HTMLElement | SVGElement) {
	const is_body = el === document.body || el === document.documentElement;
	if (lent.has(el)) {
		el.focus({ preventScroll: true }); // (still focusable: its loan waits for the blur)
		return;
	}
	const prev = el.getAttribute('tabindex');
	const restore = () => {
		lent.delete(el);
		if (prev !== null) el.setAttribute('tabindex', prev);
		else el.removeAttribute('tabindex');
	};
	el.tabIndex = -1; // focusable for this one call
	el.focus({ preventScroll: true });
	if (is_body) {
		restore(); // body keeps focus even without the attribute
		return;
	}
	lent.set(el, prev);
	// oxlint-disable-next-line ogygia/owned-effects -- the element's own tabindex loan: it ends on the element's next blur, and outlives the page when the element is kept
	el.addEventListener('blur', restore, { once: true });
}

/** The elements whose `tabindex` a navigation's focus lent until they blur, with their own value. */
const lent = new WeakMap<HTMLElement | SVGElement, string | null>();

// ── navigation state (one per document lifetime, module-level: this chunk loads once) ──────────
/** A page as a fetch got it: its HTML and the address it belongs to (where the fetch landed, after
 *  the server's redirects; the requested href when there were none). */
export type FetchedPage = { html: string; url: string };
/** A page fetch's ask: the address, and why (the purpose of the call that starts the flight is the
 *  one its request carries). */
type PageAsk = { href: string; purpose: NavPurpose };
/** A page fetch's answer: the page (`null`: not HTML, or the fetch failed), and whether the
 *  response lets us keep it. */
type Fetched = { page: FetchedPage | null; cacheable: boolean };
type Pages = import('@ogygia/machine').Flights<PageAsk, Fetched, Pick<PageAsk, 'href'>>;
let page_flights: Pages | undefined;
/** The world the cached pages are made in: a mutation moves it (`bust_page_cache`). */
let page_world: import('@ogygia/machine').World | undefined;
/** The page fetches: one flight per address, shared by every navigation and prefetch of it. A
 *  cacheable answer is kept for PREFETCH_TTL_MS, within PAGE_CACHE_MAX_BYTES (each entry weighs at
 *  least its share of it, so no more than PAGE_CACHE_MAX_ENTRIES small pages are kept). They are made
 *  in `page_world`: a move of it drops them all, a fetch in flight is aborted, and a navigation that
 *  waited on it fetches again. */
const pages = (): Pages =>
	(page_flights ??= boot_link().flights.keyed<PageAsk>()({
		name: 'router pages',
		key: ['href'],
		ignore: { purpose: 'a navigation joins the prefetch out for its address: how, not what' },
		run: (ask, signal, flight): Promise<Fetched> => run_page_fetch(ask, signal, flight),
		world: (page_world = boot_link().world()),
		keep: (answer) => (answer.page !== null && answer.cacheable ? PREFETCH_TTL_MS : 0),
		max: PAGE_CACHE_MAX_BYTES,
		weigh: (answer) =>
			Math.max((answer.page?.html.length ?? 0) * 2, PAGE_CACHE_MAX_BYTES / PAGE_CACHE_MAX_ENTRIES)
	}));
type Memo<K, V> = import('@ogygia/machine').Cache<K, V>;
/** Hrefs whose prefetched HTML was already scanned for island entries — parse once (the least
 *  recently warmed go first). (URL-level import dedupe lives in the shared `warm_island_module`.) */
let warmed_pages_memo: Memo<string, true> | undefined;
const warmed_pages = () =>
	(warmed_pages_memo ??= boot_link().cache({ name: 'warmed pages', max: 512 }));
/** (Hard SPA navigations are the router's own machine, `r.nav` (./navigation.ts), so a "same
 *  document" decision there can stop one in flight: SpaRouter.supersede. The soft refresh is its
 *  machine too, `boot_link().soft` (./soft-refresh.ts): the boot holds it, as a page without the
 *  router refreshes too.) */
/** The visually-hidden `aria-live` region that announces each navigation to screen readers. Created
 *  lazily on the first nav and reused (a live region must persist so assistive tech observes its
 *  mutations). It lives in `<body>` but is DETACHED before each body swap so the reconcile never
 *  removes it, then re-attached. See {@link announce} / {@link reset_focus}. */
let announcer: HTMLElement | null = null;

/** Moves the world the cached pages are made in: what is kept goes, and a fetch that started before
 *  the move (a prefetch out when a remote mutation lands) never fills the cache after it with the
 *  page as it was (#208), and a navigation that waited on it fetches again. (No pages yet: none to
 *  put out of date.) */
export function bust_page_cache(): void {
	page_world?.bump();
}

/**
 * Bust the SPA HTML cache after any successful Kit remote mutation (command/form POST).
 * Forms also call `invalidateAll` (soft seed refresh + bust); commands only refresh queries —
 * without this fetch hook, prefetched pages stay stale. Installed once, when this chunk loads —
 * before it there is no cache to bust.
 */
function install_remote_mutation_cache_bust() {
	if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
	const orig = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const res = await orig(input, init);
		try {
			const method = (
				init?.method ||
				(typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
			).toUpperCase();
			if (method !== 'GET' && method !== 'HEAD' && res.ok) {
				const href =
					typeof input === 'string'
						? input
						: input instanceof URL
							? input.href
							: (input as Request).url;
				if (REMOTE_MUTATION_PATH.test(href)) bust_page_cache();
			}
		} catch {
			// ok: the cache bust is a nicety; it never breaks the app's fetch
		}
		return res;
	};
}
install_remote_mutation_cache_bust();

/**
 * The page at `href`, as HTML plus the address it belongs to: a server redirect (a Kit `redirect()`
 * in load, a trailing-slash canonicalization) is followed by `fetch` transparently, and
 * `response.url` is its only trace. The landing travels WITH the HTML, through the cache and to the
 * navigation that reads it, so nothing else (a cache clear, another fetch) can take it away.
 */
export async function fetch_page(
	href: string,
	signal?: AbortSignal,
	purpose: NavPurpose = 'nav'
): Promise<FetchedPage | null> {
	// One flight per address: a kept page (a prefetched one) is served at once, and a fetch out for
	// it (a prefetch, or a navigation) is joined. Without this, a click after a hover-prefetch would
	// re-fetch (the whole point of prefetch is to skip that second request). Real navigations drop
	// the kept page after use (one-shot — see navigate()), so the next visit is still fresh.
	// PREFETCH-HIT.
	const ask: PageAsk = { href, purpose };
	// a guess, or the visitor's: a click joining a prefetch out for the page raises it to theirs
	const { PRIORITY } = boot_link();
	const priority = purpose === 'prefetch' ? PRIORITY.speculative : PRIORITY.user;
	for (;;) {
		const answer = await pages().get(ask, { signal, priority });
		if (answer !== boot_link().STALE) {
			// Warm the destination's island JS during the hover/idle runway, so the click path is
			// swap + hydrate with no first-time import() per island — the module graph is already
			// resolved when load_island() runs. This is the biggest prefetch win: without it, a warm
			// (HTML-cached) navigation still stalls hydration on cold island chunks.
			if (purpose === 'prefetch' && answer.page !== null) warm_modules(href, answer.page.html);
			return answer.page;
		}
		// this caller left (its navigation was taken over), or a prefetch, a guess, was made moot
		if (signal?.aborted || purpose === 'prefetch') return null;
		// a cache clear ended the fetch this navigation waited on: it may hold the page as it was
		// before a mutation, so fetch it again
	}
}

/** One page fetch (a flight's work): a prefetch waits for its turn in the load scheduler first, at
 *  its flight's priority (a click joining it raises it: it goes at once, at the visitor's). */
async function run_page_fetch(
	{ href, purpose }: PageAsk,
	signal: AbortSignal,
	flight: import('@ogygia/machine').InFlight
): Promise<Fetched> {
	const go = (priority?: 'high' | 'auto' | 'low') =>
		net.fetch(href, {
			signal,
			headers: nav_headers(purpose),
			...(priority ? { priority } : {})
		} as RequestInit);
	// A prefetch is a guess: it waits for the page's critical resources and shares the background
	// window (load-scheduler.ts). A navigation never waits.
	let res: Response;
	try {
		if (purpose === 'prefetch') {
			const { LoadSlot, fetch_priority_of } = boot_link();
			const slot = new LoadSlot({ kind: 'content', cls: 'speculative', label: href, flight });
			const release = await slot.ready;
			try {
				// a cache clear ended it while it waited: its turn is given back without a fetch
				if (signal.aborted) return { page: null, cacheable: false };
				res = await go(fetch_priority_of(slot.cls()));
			} finally {
				release();
			}
		} else res = await go();
		const ct = res.headers.get('content-type') || '';
		if (!ct.includes('text/html')) return { page: null, cacheable: false };
		// A file to save, whatever its type (a report sent as HTML): never a page to swap in; the
		// browser saves it and keeps the page on screen (#297).
		if (ATTACHMENT.test(res.headers.get('content-disposition') || ''))
			return { page: null, cacheable: false };
		// where it landed: `navigate()` corrects the address bar it pushed BEFORE the fetch from
		// this, or the old URL would sit over the redirected content
		const url = res.redirected && res.url ? res.url : href;
		// NOTE: we intentionally swap even non-2xx HTML (e.g. Kit's SSR'd 404/500
		// +error.svelte page) so error pages render without a full reload.
		const html = await res.text();
		const cc = res.headers.get('cache-control') || '';
		return {
			page: { html, url },
			cacheable: spa_html_cacheable(cc, res.headers.has('set-cookie'))
		};
	} catch (err) {
		if (err && (err as { name?: string }).name === 'AbortError') throw err;
		return { page: null, cacheable: false };
	}
}

/**
 * Kick off import() for every island module the prefetched page will hydrate, so they are in the
 * browser's module cache before the click. `import()` is idempotent (the loader dedupes by URL),
 * and a warmed-URL guard skips re-parsing / re-importing across repeated hover+viewport triggers.
 * A cheap attribute scan avoids building a whole detached Document during the hover window.
 */
function warm_modules(href: string, html: string) {
	if (warmed_pages().has(href)) return;
	warmed_pages().set(href, true);
	// URL-level dedupe + failure-retry live in the shared warmer (one scheme for
	// router/visible/interaction warms). The page's island graph first, so each warm below preloads
	// its island's whole graph with it.
	for (const t of tags(html, 'script')) {
		if (t.attrs.get('type') !== 'application/json' || !t.attrs.has(OGYGIA_GRAPH)) continue;
		const json = text_of(html, t, 'script');
		if (json !== null) register_island_graph(json, new URL(href, location.href).href);
	}
	// Each region's identity, and its location beside it (the file the warm then fetches): only a
	// region whose entry the browser runs (a lake's names no file)
	for (const t of tags(html, 'ogygia-region')) {
		const entry = t.attrs.get('entry');
		if (!entry || !runs_entry({ getAttribute: (name) => t.attrs.get(name) ?? null })) continue;
		note_entry_location(entry, t.attrs.get('src') ?? null, href);
		warm_island_module(entry, href);
	}
}

/**
 * PREFLIGHT — the incoming document's read-only preparation, in the task BEFORE the transition:
 *  • `<link rel="modulepreload">` hints for modules this page already warmed are dropped, so the
 *    head merge never re-issues a fetch for bytes the module map holds;
 *  • reconcile keys are stamped on the incoming regions (the fingerprint reads, off the DOM change);
 *  • the incoming page seed is parsed once, on the document (runtime/seeds.ts) — a kept island's
 *    props absorb and the soft-invalidate both reuse that parse inside the transition.
 */
function preflight(doc: Document, dest: URL) {
	for (const l of Array.from(doc.querySelectorAll('link[rel="modulepreload"]'))) {
		const href = l.getAttribute('href');
		if (href && is_warmed_module(href, dest.href)) l.remove();
	}
	stamp_region_keys(doc.body);
	page_seed_of(doc);
}

/**
 * Which client build a document belongs to: its runtime script's file and its location map's
 * (server/document-tail.ts `runtime_bootstrap_tags`) — both content-hashed, so a deploy that changed
 * any island, Svelte or the runtime names another. By file name: a `src` written relative to its
 * page reads the same from any address. Null: the document names no runtime (no island on it).
 */
function build_of(d: Document): string | null {
	const s = d.querySelector(`script[${OGYGIA_RUNTIME}]`);
	if (!s) return null;
	const file = (v: string | null) => (v ? v.slice(v.lastIndexOf('/') + 1) : '');
	return `${file(s.getAttribute('src'))} ${file(s.getAttribute(OG_LOCATIONS))}`;
}

/** A next page's stylesheet, loaded before its commit and styling nothing until then: the link,
 *  in the head under a media no screen matches, and the media and fetch priority it came with. */
type InertSheet = { link: HTMLLinkElement; media: string | null; priority: string | null };
/** What matches no screen: a sheet under it loads, and styles nothing. */
const INERT_MEDIA = 'not all';

/** The next page's sheet goes live: it styles the page as it came. */
function apply_sheet({ link, media, priority }: InertSheet): void {
	if (media === null) link.removeAttribute('media');
	else link.setAttribute('media', media);
	if (priority === null) link.removeAttribute('fetchpriority');
}

/** What a navigation builds off to the side before its commit (`navigate`'s stage): the parsed
 *  next page, the address it belongs to, whether it goes in under a view transition, its sheets
 *  (loaded, styling nothing yet), and the beacon's clock (fetched, styled; reconciled at commit). */
type Built = {
	doc: Document;
	dest: URL;
	use_vt: boolean;
	sheets: InertSheet[];
	fetched: number;
	styled: number;
	reconciled: boolean;
	/** the commit wrote its history entry (a commit that fails after it hands that entry off) */
	written: boolean;
};

// NOTE: the library does NO script processing. Scripts inserted via a client-side body swap do
// not execute (standard browser behaviour for parsed/adopted <script> nodes) — if you need code
// to run per navigation, use an island. Our own runtime module script is marked
// `data-ogygia-runtime` and is the only module script merge_head retains across swaps.
export async function navigate(
	r: SpaRouter,
	url: URL,
	from: URL,
	{
		push = true,
		pop,
		type = 'link',
		replace = false
	}: {
		push?: boolean;
		/** the entry a back or forward step is on (./router.ts `RouterHistory`) */
		pop?: HistoryEntry;
		type?: string;
		replace?: boolean;
	} = {},
	/** the router's claim for this navigation (SpaRouter.navigate made it: ./navigation.ts) */
	claim: SpaRouter['nav']['now'] = r.nav.now
): Promise<void> {
	if (r.nav.now !== claim) return; // (a newer click took over first)
	// (its `beforeNavigate` guards ran before the claim: SpaRouter.navigate)

	const dt_t0 = DEVTOOLS ? dt_now() : 0;
	// THE NAVIGATION'S OWN CLOCK (the beacon's: a slow in-app navigation is a page's cost the
	// document timing never sees): its start, the page fetched and its styles in (the build's), the
	// swap committed
	const nav_t0 = clock.mono();
	if (DEVTOOLS)
		dt_emit({
			domain: 'nav',
			name: 'nav.start',
			from: from.pathname + from.search,
			to: url.pathname + url.search,
			type
		});
	if (HOOK_NAV_STARTED)
		slots.hooks?.navStarted?.({
			from: `${from.pathname}${from.search}`,
			to: `${url.pathname}${url.search}`,
			type
		});

	// This navigation's visit: only it may apply a body swap (P2). A newer click starts a new visit:
	// every step below checks it is still `mine`, and its fetch (a task of the visit) is aborted.
	r.nav.go('loading', { href: url.href });
	const mine = r.nav.now;
	// (on a back or forward step the browser has moved the address already: the page on screen is
	// the router's, not `location`'s)
	own_live_head(r.current_url);
	// What this one navigation does is its visit's (`attempt`): leaving it (a newer click, back to
	// the page on screen, a hand-off) lets it all go. The page it brings has a visit of its own, made
	// now (runtime/session.ts `PageVisit`): what is started for that page before its swap is that
	// visit's, which the swap makes the page's, and which ends with `attempt` when there is no swap.
	const attempt = r.nav.scope;
	const next = session().next_visit();
	attempt.defer(() => {
		if (session().visit !== next) next.scope.close(); // (swapped in: the visit is the page's)
	});

	// HISTORY is written when the page goes in (the commit), never before its fetch (#310): until
	// then the address bar and the router's history are the page on screen, and a navigation that
	// brings no page (a download, a 204, one called off) leaves no entry behind (#297).
	const move: HistoryMove = pop ? 'pop' : push && !replace ? 'push' : 'replace';

	// HAND-OFFS: a response the router will not render (or no response) goes back to the browser as
	// a navigation to the address the visitor CLICKED — never to where our fetch was redirected. The
	// browser then makes its own document request and follows its own redirects, so the visitor lands
	// exactly where a navigation without the router would have; a redirect seen by a fetch is a fact
	// about that fetch. Its entry is the browser's (./router.ts `hand_off`). A hand-off ends this
	// visit: the navigation is the browser's now, and one the browser keeps the page on screen for (a
	// download, a 204) must not stay in flight (#266). A navigation that fails part way (its devalue
	// does not load, its swap throws) goes to the browser too, its error said: never left in flight,
	// never finished as if it went in (#276).
	const hand_off = (error?: unknown, written = false) =>
		r.hand_off(url, mine, written ? 'replace' : move, error);

	// A back/forward restore re-fetches (we hold no DOM snapshot); mark it so the server can skip
	// side effects the visitor already triggered on the first visit. A plain click is `nav`.
	const purpose: NavPurpose = type === 'popstate' ? 'history' : 'nav';

	// ── THE BUILD: fetch, parse, facts, preflight, sheets — off to the side, no live change ──
	// Null: nothing came, or the router will not render what came: the browser's, then.
	const build = async ({ signal, discard }: Staging): Promise<Built | null> => {
		const page = await fetch_page(url.href, signal, purpose);
		if (page === null || signal.aborted) return null;
		const { html } = page;
		const fetched = clock.mono();
		// one-shot; always fresh on real navigation (a fetch already out again for it is left be)
		pages().drop(({ href }, entry) => href === url.href && entry.kind === 'kept' && !entry.flying);

		// REDIRECT: the fetch may have landed on a different href (a Kit `redirect()` in load, a
		// canonical trailing-slash bounce). `dest` is the address the content actually belongs to —
		// used from here on for the address bar, doc key, current URL, and hash scroll, but only once
		// the router knows it will render this response itself (below). `dest` === `url` in the common case.
		let dest = url;
		if (page.url !== url.href) {
			try {
				dest = new URL(page.url, url);
			} catch {
				dest = url; // ok: a page URL that does not parse keeps the address asked for
			}
		}

		// A cross-origin landing can't be a body swap.
		if (dest.origin !== location.origin) return null;

		// ── TASK ONE: parse + facts + preflight — no live DOM change ──
		// (the sink's gate, ./html-sink.ts: the page landed on this origin)
		const own = boot_link().vouch_page_answer(dest, html);
		if (own === null) return null;
		const doc = boot_link().parse_page_document(own);
		// (its head's URLs are its address's, not the page on screen's: #449)
		resolve_head_urls(doc.head, dest);

		// csr=true Kit pages boot via inline/module scripts that cloneNode will NOT execute.
		// Hand off to a full navigation instead of a half-broken SPA swap (BRK-HEAD). Read off the
		// parsed document (the route meta, else its inline scripts) — never a regex over the string.
		if (KitBoot.document_has(doc)) return null;

		// Mixed sites: if the target page has no `ogygia-router` marker (the handle injects it on
		// every ogygia page), it is not an ogygia page — hand over to a real document navigation
		// (and stop SPA behaviour from here on).
		const marker = doc.querySelector('meta[name="ogygia-router"]');
		if (!marker) return null;
		// ANOTHER BUILD: the next page names another runtime or location map than the ones running here
		// (a deploy since this document loaded). Its islands were built against that build's runtime and
		// Svelte; woken by this document's runtime, two copies of each would meet on one page. A document
		// navigation loads it whole, on its own build.
		const next_build = build_of(doc);
		const this_build = next_build === null ? null : build_of(document);
		if (this_build !== null && next_build !== this_build) return null;
		// A page whose custom elements are in the app transform's FIRST-LOAD form (served from a store,
		// a prerender, or a cache that held the full-load copy — the server renders a router fetch as an
		// answer otherwise): only each component's own first hydrate reads that form, and swapped into
		// live hosts it would leave the transform's tree in their light DOM. Loaded, it is right.
		if (doc.querySelector('meta[name="ogygia-first-load"]')) return null;
		// The app's transform reshaped the incoming page: restore it before anything reads it (the
		// reconcile, the islands' copies). The restorer is the page's own global, when the app has one.
		(globalThis as PageGlobals).__og_restore?.(doc);

		// Same-document hash jumps already returned above (no VT). Cross-route swaps keep VT
		// even when the target has a hash (A → B#C); scroll snaps after the transition.
		const prefer_reduced_motion =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		const use_vt = marker.getAttribute('content') !== 'plain' && !prefer_reduced_motion;

		// The fetched page's relative region URLs belong to ITS address: pin them before anything reads
		// them — the batch's endpoints, the preflight, the reconcile keys (entry-locations.ts)
		for (const el of doc.querySelectorAll('ogygia-region')) pin_region_urls(el, dest.href);

		// SINGLE-FLIGHT NAV: prescan the incoming page for its load-timed deferred region calls and stream
		// them ALL in one batch request, kicked off now (before the swap). Each region binder joins the
		// batch via the store when it connects — no per-region fetch waterfall on navigation. Fired
		// synchronously so every reservation is in place before the body swap connects any binder.
		batch_regions(doc, next.scope, dest);
		// (the incoming page's seed and sidecars parse in its preflight and wakes: devalue first, when
		// one of them is in its lane — ./devalue-lane.ts)
		await devalue_for(doc);
		if (signal.aborted) return null;
		preflight(doc, dest);

		// Cold-cache FOUC guard: get the destination's stylesheets loaded BEFORE the body swap, so the
		// first post-deploy navigation never flashes unstyled content (a full-width column snapping to
		// its styled width). Warm caches resolve this instantly. They load inert, styling nothing until
		// the commit (the page on screen is not the next one, #267), and a navigation that ends before
		// its commit takes them out again.
		const sheets: InertSheet[] = [];
		await preload_stylesheets(doc.head, attempt, sheets, discard);
		if (signal.aborted) return null;
		const styled = clock.mono();
		// The transition starts in a task of its own: everything above is a finished task by then, and
		// the frame it captures is not the one that parsed 2 MB of HTML.
		await yield_task();
		return { doc, dest, use_vt, sheets, fetched, styled, reconciled: false, written: false };
	};

	// ── THE COMMIT: the DOM in one synchronous step — head, seeds, body, title ──
	const commit = (built: Built | null) => {
		if (built === null) return; // (never committed: nothing to render goes to the browser)
		const { doc, dest } = built;
		// A soft refresh still out belongs to the page being left: its late answer would merge that
		// page's head and data into this one (#202). It ends with the page it refreshes (#268).
		const { soft } = boot_link();
		if (soft.now.kind === 'refreshing') soft.go('idle');
		// the page being left (the router's history moves on below)
		const left = r.current_url;
		// (a node the page on screen added while this one loaded)
		own_live_head(left);
		// THE ENTRY, written now (#310): a new one (the one left keeps where its page was), the one on
		// screen at its new address, or the one a back or forward step is on. At the address the page
		// belongs to: a redirect's intermediate URL is never an entry, as in a browser.
		r.history.commit(dest, move, pop);
		built.written = true;
		// Reconcile in place unless a region lives where a body morph cannot reach it (a shadow
		// root — counted, not walked), or an author opted the page out on either side.
		const reconcile =
			RECONCILE_NAV &&
			!!slots.morph &&
			!regions_in_shadow() &&
			!opts_out_of_reconcile(document.body) &&
			!opts_out_of_reconcile(doc.body);
		// Pull the a11y announcer out of the body before the reconcile — it isn't in the incoming
		// HTML, so a body morph would remove it. Re-attached (with the new title) by `announce`.
		announcer?.remove();
		// LIFECYCLE (Astro-parity DOM events): last chance to read the OUTGOING page's DOM.
		document.dispatchEvent(new Event('og:before-swap'));
		// the next page's sheets were the navigation's: now the page's own, so the merge keeps them
		for (const sheet of built.sheets) session().claim_page_head(sheet.link);
		const unlisted = merge_head(doc.head); // keeps our runtime module script alive across swaps
		// the next page's sheets, loaded while it was built, style it from now on (#267)
		for (const sheet of built.sheets) apply_sheet(sheet);
		// CONTINUITY: snapshot the LEAVING page's changed island form fields (session-scoped) so
		// returning to it restores what the visitor was mid-typing. Read the old body now.
		if (slots.forms.enabled) slots.forms.snapshot(document.body, left.pathname);
		// Clear session state BEFORE body connect so new regions never see the previous page; then
		// seed the shared page store + remote seeds from the new doc (the parse preflight made) —
		// `$app/state` page.url/params/data update reactively inside KEPT islands, and every island
		// that connects below reads the new page, never a stale script. Seeds first, DOM second.
		prepare_spa_document(next);
		apply_soft_invalidate_doc(doc);
		if (reconcile) {
			// THE nav path: diff the live body toward the parsed one IN PLACE. Matched regions
			// (same fingerprint) keep their live hydrated node and island state; changed regions
			// re-mount; shell + keep-chrome (data-ogygia-keep) morph in place. Both paths release
			// the hub ids nothing on the next page owns, inside the swap.
			reconcile_body(document.body, doc.body, slots.morph!);
			built.reconciled = true;
			adopt_title(doc);
			session().settle_lakes_in(document.body);
		} else {
			// FALLBACK (reconcile off, or a region nested in an open shadow root morph can't pierce):
			// an outerSync body swap — keep the live <body> node (and everything attached to it),
			// sync its attributes, replace its children. keep-continuity does NOT survive here —
			// islands re-mount like a hard nav. This path is rare; the reconcile path above is the norm.
			if (DEVTOOLS)
				dt_emit({
					domain: 'nav',
					name: 'nav.fallback',
					reason: !slots.morph ? 'no-morph' : 'shadow-region'
				});
			swap_body(document.body, doc.body);
			adopt_title(doc);
			session().settle_lakes_in(document.body);
		}
		// (roots restored in the incoming page adopt their keyed sheets now that they are in this one)
		(globalThis as PageGlobals).__og_restore_adopt?.();
		// ONE COPY of island head content: an island KEPT across the swap still renders its head live,
		// and the merge above put the next page's server copy of the same content in beside it — retire
		// that copy now that the reconcile has settled which islands stayed (runtime/session.ts).
		session().retire_page_head_copies();
		// the region head nodes the new page does not list go now, but for those a region kept across
		// the swap still uses (#275) or owns (#806)
		release_head_nodes(unlisted);
		// STREAMED pages fetched over SPA nav arrive COMPLETE (fetch buffers the stream), so any
		// late templates still inert in the parsed doc apply now — the inline boot script that
		// handles them on a full load never executes across a body swap.
		apply_late_templates(document.body);
		// Old islands disconnected; new hydrates are queued — sweep stale Kit remotes now.
		finish_spa_document();
		// CONTINUITY: restore fields the visitor left on THIS page in a prior visit (this session).
		if (slots.forms.enabled) slots.forms.restore(url.pathname);
		// LIFECYCLE: the INCOMING page's DOM is in place (islands may still be waking on their
		// own schedules — this is the DOM milestone, not a hydration barrier).
		document.dispatchEvent(new Event('og:after-swap'));
	};

	// THE NEXT PAGE IS STAGED (`stage`, @ogygia/machine): built off to the side, then switched in
	// with one synchronous commit, or given back whole. It is this navigation's visit's: a newer
	// click, back to the page on screen or a hand-off closes it, which gives back what was built
	// (the next page's sheets come out of the head, #267) and refuses a commit still to come.
	const staged = boot_link().stage<Built | null>(attempt, { name: 'navigation', build, commit });
	let built: Built | null | Stale;
	try {
		built = await staged.ready;
	} catch (error) {
		return hand_off(error); // (its devalue did not load, or another step of it threw)
	}
	if (is_stale(built) || r.nav.now !== mine) return;
	if (built === null) return hand_off();
	const { dest } = built;

	// One path with or without a view transition: a commit refused (a newer navigation took over
	// before the transition's callback ran) changes nothing, and one that throws is put back and
	// goes to the browser (#276).
	const out: { failed?: { error: unknown } } = {};
	const swap = () => {
		try {
			staged.commit();
		} catch (error) {
			out.failed = { error };
		}
	};
	if (built.use_vt && document.startViewTransition) {
		// Fold names with no counterpart on the destination into the page cross-fade, so a shell
		// change (docs sidebar ↔ marketing page) doesn't fire dozens of solo enter/exits over a
		// holed-out root snapshot. Matched names (the docs↔docs highlight slide) are untouched.
		// Captured NOW — before the transition snapshots `before` — and restored after it settles.
		const restore_vt_names = fold_orphan_vt_names(document.body, built.doc.body);
		const t = document.startViewTransition(swap);
		// A rapid follow-up navigation skips this transition; the browser then rejects `.ready`
		// and `.finished` with "Transition was skipped". Nothing awaits those, so without a catch
		// they surface as unhandled rejections (console noise, no functional effect). Swallow them.
		t.ready?.catch(() => {}); // ok: a skipped transition (a rapid next navigation); nothing awaits it
		// Restore folded names once the transition settles (resolve OR skip) — the next same-shell
		// nav needs them back, and this doubles as the `.finished` rejection catch.
		(t.finished ?? Promise.resolve()).then(restore_vt_names, restore_vt_names);
		await t.updateCallbackDone.catch(() => {}); // ok: `swap` never throws (a failed commit is `out.failed`); this only waits for it
		if (out.failed) t.skipTransition?.();
	} else {
		swap();
	}
	if (out.failed) return hand_off(out.failed.error, built.written);
	if (r.nav.now !== mine) return;

	// applied: a later same-address click is a refresh, not a duplicate
	r.nav.move('loading', 'settling', { href: url.href });
	const settled = r.nav.now;
	if (HOOK_NAVIGATED)
		slots.hooks?.navigated?.({
			from: `${from.pathname}${from.search}`,
			to: `${dest.pathname}${dest.search}`,
			type,
			t: nav_t0,
			fetched: built.fetched,
			styled: built.styled,
			swapped: clock.mono(),
			href: url.href,
			reconciled: built.reconciled
		});
	if (DEVTOOLS)
		dt_emit({
			domain: 'nav',
			name: 'nav.finish',
			to: dest.pathname + dest.search,
			ms: dt_now() - dt_t0,
			reconciled: built.reconciled,
			vt: !!(built.use_vt && document.startViewTransition)
		});

	// Instant after a body swap — CSS smooth must not animate programmatic post-nav scroll. A back
	// or forward step puts its page where the visitor left it, however it was left (#270).
	const scroll = pop?.scroll;
	if (replace) {
		// same-URL replace navigate — keep current scroll
	} else if (scroll) {
		hold_scroll(scroll, next.scope);
	} else {
		jump_to_hash(dest.hash);
	}

	// ACCESSIBILITY (scroll has settled): announce the new page to screen readers, then reset
	// keyboard focus to the top of it — the two things a full navigation gives for free and a body
	// swap does not. A back or forward step gives focus back to what had it, when it is still there.
	announce(dest);
	reset_focus(dest.hash, pop?.focus ?? null);

	r.run_after(from, dest, type);
	// LIFECYCLE: the navigation is COMPLETE (head merged, body in place, scroll settled) — the
	// per-navigation hook for code that a body swap's inert <script> tags can never run. Also
	// fired once on initial load by the runtime boot, so ONE listener covers every page view.
	document.dispatchEvent(new Event('og:page-load'));
	// The navigation is done: nothing is in flight. Ending its visit drops what the visit held (its
	// fetch's controller, whose listener once kept the parsed document and its HTML alive until the
	// next navigation, ~1 MB) — unless a newer navigation already took over.
	if (r.nav.now === settled) r.nav.go('idle');
	// new <body> -> re-evaluate eager/viewport preload links on the freshly-swapped page
	r.scan_preload_links();
}

/** The most a Back or Forward holds its page for a region above that never settles (one whose code
 *  failed to load): a hold ends when the regions above have settled, not on a timer. */
export const SCROLL_HOLD_MS = 10_000;

/**
 * A Back or Forward puts its page where the visitor left it (#270), and KEEPS it there while the
 * page lays out (#452). The scroll goes back right after the swap, before every region has its
 * height: a header that sizes once it wakes grew above the saved position afterwards, and the page
 * landed off by that height (the browser's scroll anchoring moved it with the growth, a frame after
 * any put-back could see it). So the position is held, with the browser's anchoring off: each time
 * the page's size changes it is put back, until the islands above the saved position that wake on
 * their own have woken and laid out, the visitor scrolls, clicks or types themselves, the page's
 * visit ends (`visit`: a newer navigation takes over), or a scroll that is not a layout change (the
 * app's own `scrollTo`) moves it elsewhere ({@link SCROLL_HOLD_MS} at most, for one that never
 * wakes). Instant, never smooth: CSS `scroll-behavior: smooth` must not animate a programmatic
 * restore.
 */
export function hold_scroll(to: { x: number; y: number }, visit: Scope): void {
	/** Where the last put-back left the page: the saved position, or, on a page still too short to
	 *  reach it, the bottom the browser clamped it to. */
	let at = { x: scrollX, y: scrollY };
	const put = () => {
		if (scrollX === to.x && scrollY === to.y) return;
		const html_el = document.documentElement;
		const prev = html_el.style.scrollBehavior;
		html_el.style.scrollBehavior = 'auto';
		try {
			window.scrollTo(to.x, to.y);
		} finally {
			html_el.style.scrollBehavior = prev;
		}
		at = { x: scrollX, y: scrollY };
	};
	put();
	if (visit.closed) return;
	const hold = visit.child();
	// while held, where the page sits is the hold's: the browser's anchoring is off, and back as it was
	const html = document.documentElement;
	const anchoring = html.style.overflowAnchor;
	html.style.overflowAnchor = 'none';
	hold.defer(() => (html.style.overflowAnchor = anchoring));
	hold.timeout(() => hold.close(), SCROLL_HOLD_MS);
	// the islands above that wake on their own: once each has, one frame lays it out, and it ends
	const above = new Set(islands_above(to.y));
	const settled = () => {
		if (above.size === 0) hold.timeout(() => hold.timeout(() => hold.close(), 0), 'frame');
	};
	hold.on(document, 'ogygia:hydrated', (event: Event) => {
		if (above.delete(event.target as Element)) settled();
	});
	settled();
	// the visitor moves the page: from then on where it sits is theirs
	for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const)
		hold.on(window, type, () => hold.close(), { capture: true, passive: true, once: true });
	// a scroll that left it elsewhere (the app's own `scrollTo`): its scroll is not held back. One the
	// browser made with a layout change (scroll anchoring) is put back by the observer below in that
	// frame, before its scroll event is heard
	hold.on(
		window,
		'scroll',
		() => {
			// (where a put-back left it, clamped or not, is the hold's own scroll)
			const ours = (scrollX === to.x && scrollY === to.y) || (scrollX === at.x && scrollY === at.y);
			if (!ours) hold.close();
		},
		{ passive: true }
	);
	if (typeof ResizeObserver !== 'undefined')
		hold.watch(new ResizeObserver(put)).observe(document.documentElement);
}

/** The islands not live yet that start above `y` (in the page) and wake on their own: `load` and
 *  `idle`, and a `visible` one reaching down past `y` (on screen there). One inside another island
 *  wakes with it; one that waits for the visitor (`interaction`) is theirs. */
function islands_above(y: number): Element[] {
	const out: Element[] = [];
	for (const r of document.querySelectorAll('ogygia-region[entry]:not([data-hydrated])')) {
		if (r.parentElement?.closest('ogygia-region[entry]')) continue;
		const wake = r.getAttribute('wake') || 'load';
		if (wake !== 'load' && wake !== 'idle' && wake !== 'visible') continue;
		const box = r.getBoundingClientRect();
		if (box.top + scrollY >= y) continue;
		if (wake === 'visible' && box.bottom + scrollY <= y) continue;
		out.push(r);
	}
	return out;
}

/**
 * Soft invalidate: refresh page/remote seeds for the current URL without navigation.
 *
 * Kit's `invalidateAll` re-runs loads in place — it is **not** a navigation (no
 * `beforeNavigate` / `afterNavigate`). Remote `form()` always calls this on success; a
 * full SPA navigate+VT here was wiping live island state. We bust the HTML cache,
 * re-fetch, merge head, and refresh document seeds only — no VT, no body swap, no
 * island remount, no live query-map clear, no auto-refresh of live queries. Islands
 * that need query updates use `.refresh()`, or `submit().updates(q)` with server
 * `requested(q).refreshAll()` (updates alone does not populate response `q`).
 *
 * Its own machine (`soft`, ./soft-refresh.ts, which the boot holds: a page without the router
 * refreshes too) so soft fetches never cancel an in-flight click navigation; a real navigation's
 * commit ends a soft refresh in flight.
 *
 * It refreshes the PAGE ON SCREEN (`on_screen`: the router's, which knows it; the address bar
 * without the router), never the page a navigation is still bringing (#268). The refreshed page is
 * staged like a navigation's (`stage`): fetched and parsed off to the side, merged in one commit,
 * which a navigation that went in first refuses (its commit ended this refresh). A refresh whose
 * devalue fails to load ends, and says so to its caller.
 */
export async function invalidate_all(on_screen?: URL | null): Promise<void> {
	bust_page_cache();
	const url = on_screen ?? new URL(location.href);

	const { soft, stage } = boot_link();
	soft.go('refreshing', { href: url.href });
	const mine = soft.now;

	const staged = stage<Document | null>(soft.scope, {
		name: 'soft refresh',
		build: async ({ signal }) => {
			const fetched = await fetch_page(url.href, signal);
			if (fetched === null || signal.aborted) return null;
			// (the sink's gate, ./html-sink.ts: only a page that landed on this origin is merged)
			const landed = new URL(fetched.url, url);
			const own = boot_link().vouch_page_answer(landed, fetched.html);
			if (own === null) return null;
			const doc = boot_link().parse_page_document(own);
			// (its head's URLs are its address's: #449)
			resolve_head_urls(doc.head, landed);
			if (KitBoot.document_has(doc) || !doc.querySelector('meta[name="ogygia-router"]'))
				return null;
			await devalue_for(doc);
			return doc;
		},
		commit: (doc) => {
			if (doc === null) return;
			// (the page's regions all stay: their head nodes go once no region uses or owns them)
			release_head_nodes(merge_head(doc.head));
			apply_soft_invalidate_doc(doc);
		}
	});
	try {
		// (STALE: a navigation went in, or a newer refresh took over)
		if (is_stale(await staged.ready)) return;
		staged.commit();
	} finally {
		if (soft.now === mine) soft.go('idle');
	}
}

/**
 * ACCESSIBILITY — announce the new page. A body swap is invisible to assistive tech: no document
 * `load`, so a screen reader is never told the page changed. Mirror what a full navigation (and
 * SvelteKit) give for free — a visually-hidden `aria-live` region whose text becomes the new
 * `<title>`, so the page is spoken on arrival. The region is created once and reused (it must
 * already be in the DOM when its text changes for AT to observe it); it was detached before the
 * swap so the reconcile couldn't remove it, and is re-attached here before its text is set.
 */
function announce(dest: URL) {
	let el = announcer;
	if (!el) {
		el = document.createElement('div');
		el.setAttribute(OGYGIA_ANNOUNCER, '');
		el.setAttribute('aria-live', 'assertive');
		el.setAttribute('aria-atomic', 'true');
		// Visually hidden but readable by AT (the standard sr-only recipe — NOT display:none).
		el.style.cssText = `position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0`;
		announcer = el;
	}
	if (el.parentNode !== document.body) document.body.appendChild(el);
	el.textContent = document.title || dest.pathname;
}

/**
 * ACCESSIBILITY — reset keyboard focus after a navigation, so a keyboard or screen-reader user
 * lands at the top of the new page instead of wherever focus was on the old one (a full navigation
 * does this natively; a body swap does not). SvelteKit's algorithm: a `[autofocus]` element wins;
 * else a `#hash` target; else focus falls back to `<body>` (made momentarily focusable). The one
 * ogygia twist: a control INSIDE kept/persisted chrome (`data-ogygia-keep` / `data-persist`) that
 * survived the nav is left focused — the visitor is still using that persistent widget. A back or
 * forward step first gives focus back to the element (`kept`, by id) that had it when its entry
 * was left (./router.ts `RouterHistory`).
 */
function reset_focus(hash: string, kept: string | null = null) {
	const active = document.activeElement as HTMLElement | null;
	if (
		active &&
		active !== document.body &&
		active.isConnected &&
		active.closest(`[${OGYGIA_KEEP}],[data-persist]`)
	) {
		return; // focus is on surviving persistent chrome — don't yank it to the top
	}

	// back or forward to a page whose entry kept the element that had focus when it was left
	const was = kept ? document.getElementById(kept) : null;
	if (was) return focus_reset(was);
	// (the boot's reading of a fragment, through the router's link: ./fragment.ts is a boot module)
	const target = router_link().fragment_target(hash);
	if (target instanceof HTMLElement || target instanceof SVGElement) return focus_reset(target);
	const autofocus = document.querySelector<HTMLElement>('[autofocus]');
	if (autofocus) {
		autofocus.focus();
		return;
	}
	focus_reset(document.body);
}

/**
 * Merge <head>: keep nodes present in both, remove stale, add new. Keeps runtime scripts alive.
 * Returns the region head nodes the new head does not list (region sheets, and tags naming an owning
 * region): they are for the regions that use or own them too (./region-sheets.ts), so they go only
 * after the swap, once it is settled which regions stayed.
 */
/** The next page's title, as a fresh load of it has one: only when it carries a `<title>`. Setting
 *  `document.title` makes a `<title>` where there is none (test/browser/nav-no-title.test.ts); the
 *  head merge already took the leaving page's own out. */
function adopt_title(next: Document): void {
	// (an HTML <title>, as the `title` getter reads: an SVG one in the body does not count)
	if (next.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'title').length > 0)
		document.title = next.title;
}

function merge_head(new_head: HTMLHeadElement): Element[] {
	const current = document.head;
	// Only the PAGE's nodes take part (runtime/session.ts — who owns each node in <head>). An island's
	// live head content is its own: removing a node of it here is what let Svelte's teardown of that
	// island walk past its block and delete the next page's tags; and an island node must not stand in
	// for the next page's copy either (the island may be torn down in the reconcile that follows —
	// the copy the page needs goes in, and the one-copy rule retires it again if the island stays).
	// Nodes that are not ours at all (a third-party inject) stay, as under Kit's own router.
	// (the owners the page being left listed for its shared sheets: its tail is still in the body)
	adopt_owner_record(document, current);
	const current_nodes = live_page_head();
	const next_keys = new Set<string>();
	for (const node of Array.from(new_head.children)) {
		if (is_dangerous_head_node(node)) continue;
		next_keys.add(head_node_key(node));
	}
	// remove stale nodes — keep runtime / vite-dev CSS across swaps
	const unlisted: Element[] = [];
	for (const [key, node] of current_nodes) {
		if (next_keys.has(key)) continue;
		if (keep_head_node_across_spa(node)) continue;
		if (node.hasAttribute(OGYGIA_REGION_CSS) || node.hasAttribute(OG_OWNER)) unlisted.push(node);
		else node.remove();
	}
	// add / replace nodes (skip dangerous head policy tags), each in its fresh-load place (`head_slot`)
	const live = new Map(current_nodes);
	for (const node of Array.from(new_head.children)) {
		if (is_dangerous_head_node(node)) continue;
		const key = head_node_key(node);
		const existing = current_nodes.get(key);
		// Kit FOUC bag: always refresh content (same key every page, different CSS). The new bag goes
		// in, then the old one comes out.
		if (key === 'STYLE:data-sveltekit') {
			live.delete(key);
			if (existing) existing.remove();
			live.set(key, install_head_style(node, current, head_slot(node, live)));
			continue;
		}
		if (existing) {
			// the node it has stays, owned also by the islands the next page's copy names (#854)
			if (node.hasAttribute(OG_OWNER)) add_head_owners(existing, head_owners(node));
			continue;
		}
		const at = head_slot(node, live);
		if (node.tagName === 'STYLE') {
			live.set(key, install_head_style(node, current, at));
		} else {
			const copy = node.cloneNode(true) as Element;
			session().claim_page_head(current.insertBefore(copy, at));
			live.set(key, copy);
		}
	}
	// (the kept runtime script takes the next response's mark and code origins: RESPONSE-MARK, #1045)
	adopt_response(new_head.ownerDocument);
	return unlisted;
}

/** The page's own nodes in the live <head>, by key (runtime/session.ts — who owns each node). */
function live_page_head(): Map<string, Element> {
	const owned = session().page_head;
	const out = new Map<string, Element>();
	for (const node of Array.from(document.head.children))
		if (owned.has(node)) out.set(head_node_key(node), node);
	return out;
}

/**
 * Where a next-page head node goes in the live <head>: right after the live copy of the nearest node
 * before it in the next head, or at the head's top when none is live. So the page's own nodes keep
 * the next document's order, the cascade order a fresh load has (test/browser/nav-head-order.test.ts,
 * #794). It always follows a node of the PAGE, never an island's: an island's live head block (Svelte
 * removes its range on teardown) is never split by a page node going in.
 */
function head_slot(node: Element, live: ReadonlyMap<string, Element>): Node | null {
	for (let p = node.previousElementSibling; p !== null; p = p.previousElementSibling) {
		if (is_dangerous_head_node(p)) continue;
		const at = live.get(head_node_key(p));
		if (at !== undefined && at.parentNode === document.head) return at.nextSibling;
	}
	return document.head.firstChild;
}

/**
 * Load the destination page's stylesheets into the live `<head>` and resolve once they have
 * loaded — call this BEFORE the body swap. A freshly appended `<link rel="stylesheet">` loads
 * asynchronously, so swapping the body first shows the new route unstyled (e.g. a content column
 * at full width) until the sheet arrives. That window is invisible on a warm cache but flashes on
 * the first visit after a deploy, when the route CSS isn't cached yet. Preloading here closes it;
 * `merge_head` then dedupes these by key so nothing is added twice. Capped so a stalled sheet
 * can't hang navigation.
 *
 * Each loads INERT: under a media no screen matches (at the fetch priority of a sheet that does),
 * so a sheet that arrived first never styles the page still on screen while the navigation waits
 * for the rest (#267). The commit gives each its own media back (`apply_sheet`). The wait is the
 * navigation's (`attempt`: its listeners and its cap go when it ends); the sheets are the stage's
 * (listed in `sheets`, given back by `discard`): a navigation that ends before its commit takes
 * them out again.
 */
function preload_stylesheets(
	new_head: HTMLHeadElement,
	attempt: Scope,
	sheets: InertSheet[],
	discard: Staging['discard']
): Promise<unknown> {
	const present = new Set<string>();
	for (const node of Array.from(document.head.children)) {
		if (node.tagName === 'LINK' && node.getAttribute('rel') === 'stylesheet') {
			present.add(head_node_key(node));
		}
	}
	const live = live_page_head();
	const pending: Promise<void>[] = [];
	for (const node of Array.from(new_head.children)) {
		if (node.tagName !== 'LINK' || node.getAttribute('rel') !== 'stylesheet') continue;
		if (is_dangerous_head_node(node)) continue;
		// A disabled link never loads (Kit's stand-in for a sheet it inlined, `disabled media="(max-width:
		// 0)"`): waiting for it held every navigation to the full cap. The head merge still copies it.
		if (node.hasAttribute('disabled')) continue;
		const key = head_node_key(node);
		if (present.has(key)) continue;
		present.add(key);
		const link = node.cloneNode(true) as HTMLLinkElement;
		const sheet: InertSheet = {
			link,
			media: link.getAttribute('media'),
			priority: link.getAttribute('fetchpriority')
		};
		link.setAttribute('media', INERT_MEDIA);
		if (sheet.priority === null) link.setAttribute('fetchpriority', 'high');
		pending.push(
			new Promise<void>((resolve) => {
				attempt.on(link, 'load', () => resolve(), { once: true });
				attempt.on(link, 'error', () => resolve(), { once: true });
			})
		);
		// (the navigation's until its commit claims it for the page: a soft refresh of the page on
		// screen merges only that page's nodes, and took this one out, #1124)
		document.head.insertBefore(link, head_slot(node, live));
		live.set(key, link);
		sheets.push(sheet);
		discard(() => link.remove());
	}
	if (!pending.length) return Promise.resolve();
	// Never let a hung stylesheet block the swap indefinitely.
	return new Promise<void>((resolve) => {
		const cancel = attempt.timeout(resolve, STYLESHEET_WAIT_MS);
		void Promise.all(pending).then(() => {
			cancel();
			resolve();
		}); // ok: every pending sheet resolves, on load or on error
	});
}

/**
 * SINGLE-FLIGHT NAVIGATION. Collect the incoming page's deferred, load-timed region calls and stream them as
 * one batch. Reads the RENDERED holes (`<ogygia-region render="defer" endpoint>`), so it covers
 * both placed server islands and held `region()` deferred regions alike — authoring syntax is
 * irrelevant. Only `when="load"` (or unset) is batched: a region scheduled `visible`/`idle`/media
 * stays lazy and fetches on its own trigger, so dynamic schedules are preserved, not eagerly pulled.
 */
/** `visit`: the scope of the page's visit, the batch's owner (a navigation called off stops it).
 *  `dest`: the page the holes are for, which the batch names (it leaves from the page being left). */
function batch_regions(doc: Document, visit: Scope, dest: URL) {
	const endpoints: string[] = [];
	for (const el of Array.from(doc.querySelectorAll('ogygia-region[render="defer"][endpoint]'))) {
		const when = el.getAttribute('when') || 'load';
		if (when !== 'load') continue; // lazy schedules keep their own timing — never batch them early
		const ep = el.getAttribute('endpoint');
		if (ep) endpoints.push(ep);
	}
	// (the page's early start does not run here: a swapped-in script is inert, so the batch asks once)
	if (!endpoints.length) return;
	if (DEVTOOLS) dt_emit({ domain: 'nav', name: 'nav.batch', count: endpoints.length });
	// Through the seam, never a static `frame-nav` import: an app with `router` but no
	// deferred/live/lake region has no `frames` feature (and no `render="defer"` holes — so
	// `endpoints` is empty above and we already returned). Optional-chain keeps that honest.
	void slots.frames?.stream?.(endpoints, visit, dest.href); // ok: a batch settles on every end, called off or broken off (frame-nav.ts streamFrames)
}
