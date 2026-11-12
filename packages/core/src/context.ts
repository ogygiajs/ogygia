import { getContext, setContext } from 'svelte';
import { BROWSER } from 'esm-env';
import {
	get_request_event,
	csr_true_routes,
	error_csr_true_routes,
	root_layout_csr_true
} from '#region-server';
import { kit_hydrates_page } from './runtime/kit-boot.ts';

// The nested-island mark (same `Symbol.for` rule as the keys below) is a leaf: nested.ts says why.
export { setNested, isNested } from './nested.ts';

// Context key marking "this subtree is OPAQUE to Kit" — a lake's inside (a `wake: 'none'` region), or
// any render whose HTML only ever lands in an opaque region (a held region's: a hole's answer, a baked
// region's first HTML — region.ts, server/render-region-html.ts set it on their roots by this global
// name). Same `Symbol.for` rule as NESTED_KEY (nested.ts). Kit's hydration never enters such HTML — on a csr=true
// page the region ADOPTS its element as opaque DOM (Region.svelte) — so the regions authored in it
// belong to ogygia's world on EVERY page: the server must emit their real `<ogygia-region>` even when
// the document is Kit-hydrated. Region reads this to switch its csr=true inline degradation off; the
// runtime mirrors it with `inside_opaque` (region-attrs.ts).
const LAKE_KEY = Symbol.for('ogygia.lake-subtree');

/** Mark the current subtree as opaque to Kit — a lake's inside (LakeBoundary). */
export function setInLake(): void {
	setContext(LAKE_KEY, true);
}

/** True when the subtree is opaque to Kit (a lake's inside, or a held region's render). */
export function isInLake(): boolean {
	return getContext(LAKE_KEY) === true;
}

// Context key marking "this subtree is a LIVE SNIPPET's body" — set by the snippet's own render root on
// both legs (region-snippet.ts, which can't import this module: same `Symbol.for` key). A hole authored
// there keeps `render: 'deferred'` inside the island the snippet crossed into: the server emits its real
// region and the snippet's hydrate adopts that element as it stands (Region.svelte, server branch). An
// island rendered inline in the snippet resets it: the holes of ITS template follow the nested rule.
const LIVE_SNIPPET_KEY = Symbol.for('ogygia.live-snippet');

/** Reset the live-snippet mark for the current subtree (an inline island inside a snippet). */
export function setInLiveSnippet(value: boolean): void {
	setContext(LIVE_SNIPPET_KEY, value);
}

/** True inside a live snippet's body (and not under an island it renders inline). */
export function isInLiveSnippet(): boolean {
	return getContext(LIVE_SNIPPET_KEY) === true;
}

// Context key marking "this server island is rendering INLINE in the page pass" — it sits inside a
// `wake` island, where `render: 'deferred'` is ignored (the nested rule) and its component renders
// as a plain child instead of on the endpoint. `keepFallback()` reads it: thrown here its signal
// would not reach the handle's catch but Kit's error page (a whole site went 500 on a footer hole
// placed inside an island). Same `Symbol.for` discipline as the keys above.
const HOLE_INLINE_KEY = Symbol.for('ogygia.hole-inline');

/** Region.svelte marks the subtree of a server island it is rendering inline (nested). */
export function setHoleInline(): void {
	setContext(HOLE_INLINE_KEY, true);
}

/** Is this render a server island's component rendering INLINE (nested in an island)? */
export function isHoleInline(): boolean {
	return getContext(HOLE_INLINE_KEY) === true;
}

/** Kit `route.id`, GROUP segments (`(app)`) stripped — mirrors the compiler's `normalize_route_id`
 *  so both sides match whether or not Kit keeps groups in `route.id`. Root → `/`. */
function normalize_route_id(id: string): string {
	const segs = id
		.split('/')
		.filter(Boolean)
		.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
	return `/${segs.join('/')}`;
}

/**
 * Does Kit hydrate THIS WHOLE DOCUMENT? The leaf page's effective csr is the single fact that decides
 * it, so a `<Region>` reads it directly — no per-host context cascade. When true, every island (a
 * csr=true page's own, a csr=false layout's chrome, a shared component's) degrades to a plain inline
 * component that Kit hydrates. Server: the route is in the build-time csr=true set. Client: Kit
 * shipped its bootstrap. Same fact on both legs → the inline/island choice can never desync at
 * hydrate. (Replaces the old `CSR_TRUE_KEY` marker + `csr=false` reset, which only re-derived this
 * number indirectly through the context cascade.)
 */
export function documentIsCsrTrue(error_render = false): boolean {
	if (BROWSER) return kit_hydrates_page();
	try {
		const event = get_request_event() as { route?: { id?: string | null } };
		// An ERROR render (a 404 / 500 page) is Kit's layout-branch decision, not the page's: the
		// caller (Region) passes what it reads off Kit's page state, and the handle passes the
		// response status — the same map answers both.
		return error_render
			? error_route_is_csr_true(event.route?.id)
			: route_is_csr_true(event.route?.id);
	} catch {
		return false; // ok: off-request (prerender helper, etc.) → not a Kit-hydrated document
	}
}

/**
 * PUBLIC: is the current page an ogygia page (csr=false), as opposed to a csr=true page Kit hydrates
 * whole? The inverse of {@link documentIsCsrTrue}, so it answers on BOTH legs with no requestEvent
 * handling on the caller's side — server reads the request's route against the build-time csr set,
 * client reads Kit's bootstrap. Meant for shared code (a store, a helper) that must branch on which
 * world it runs in. Off-request on the server (a module init, a prerender helper with no page) there
 * is no document to speak of, so it returns `false`.
 */
export function isOgygiaPage(): boolean {
	return !documentIsCsrTrue();
}

/** The same fact from a route id in hand (the handle has the event): is this route's leaf page
 *  csr=true? A build-time answer — never a scan of the rendered document. */
export function route_is_csr_true(id: string | null | undefined): boolean {
	return id != null && csr_true_routes.has(normalize_route_id(id));
}

/** The ERROR-page twin: does Kit hydrate this route's `+error.svelte`? Kit renders an error page
 *  with the layout branch only (the page node — and its `csr = false` — is dropped), so this reads
 *  the layouts' answer; a routeless response (no route matched) is the root layout's. */
export function error_route_is_csr_true(id: string | null | undefined): boolean {
	if (id == null) return root_layout_csr_true;
	return error_csr_true_routes.has(normalize_route_id(id));
}

/** Per-request: only one `data-ogygia-runtime` script should be emitted (the first island). */
const runtime_claimed = new WeakMap<object, true>();

/** Per-request: stylesheet hrefs already linked in this SSR pass, each with the owner its tag names. */
const region_css_claimed = new WeakMap<object, Map<string, string>>();

/** Context key: the fingerprint of the outermost island a region renders inside (server only). */
const HEAD_OWNER = Symbol.for('ogygia.head-owner');

/** The fingerprint the head tags of the region rendering now belong to: the outermost island
 *  around it, '' outside any (server/region-css.ts `head_owner_attr`). Call during setup. */
export function head_owner(): string {
	return (getContext(HEAD_OWNER) as string | undefined) ?? '';
}

/** An outermost island names itself the owner of every head tag rendered inside it. */
export function set_head_owner(fp: string): void {
	setContext(HEAD_OWNER, fp);
}

/** Per-request: island entries already stamped `<meta name="ogygia-kit-island">` in this pass. */
const kit_island_claimed = new WeakMap<object, Set<string>>();

/**
 * Claim an INLINE-rendered island's entry for this SSR request — true the first time, so the page
 * stamps one `<meta name="ogygia-kit-island" content="<entry>">` per rendered island, however many
 * instances render. The client wrapper's lazy component module reads the stamp before Kit hydrates
 * (emit.ts `lazy_entry_source`): a stamped island's entry is imported, an unstamped one costs
 * nothing. Client / no-request → false (nothing to stamp there).
 */
export function claim_kit_island(entry: string): boolean {
	if (!entry) return false;
	try {
		const event = get_request_event() as object;
		let seen = kit_island_claimed.get(event);
		if (!seen) kit_island_claimed.set(event, (seen = new Set()));
		if (seen.has(entry)) return false;
		seen.add(entry);
		return true;
	} catch {
		return false; // ok: client / no request: nothing to stamp, as said above
	}
}

/**
 * Claim stylesheet hrefs for this SSR request, returning only the not-yet-claimed ones. A held
 * region's component is server-picked, so its CSS is on no page stylesheet (Kit links CSS from the
 * route's STATIC import graph — it never reads the rendered page). The region wrapper links it from
 * the render pass instead, via `<svelte:head>`; claiming here dedupes so five `Feature` blocks on a
 * page link their shared sheet once. Client / no-request → [] (SSR already linked them).
 *
 * `owner` is the head-tag owner of the claiming region (`head_owner`). A sheet already linked under
 * another owner is handed to `shared`: its tag names only the first, so the claimer is listed as
 * one more owner elsewhere (the document tail, #854).
 */
export function claim_region_css(
	hrefs: string[],
	owner = '',
	shared?: (href: string) => void
): string[] {
	if (!hrefs.length) return [];
	let seen: Map<string, string> | undefined;
	try {
		const event = get_request_event() as object;
		seen = region_css_claimed.get(event);
		if (!seen) region_css_claimed.set(event, (seen = new Map()));
	} catch {
		// ok: no request (the client, or off-request): SSR already linked them
		return [];
	}
	const fresh: string[] = [];
	for (const h of hrefs) {
		const first = seen.get(h);
		if (first === undefined) {
			seen.set(h, owner);
			fresh.push(h);
		} else if (owner !== '' && owner !== first) shared?.(h);
	}
	return fresh;
}

/**
 * Claim the single runtime-script slot for this SSR request. An island/server placement emits the
 * runtime bootstrap so it hydrates even with the router off; when the router is on, the handle
 * injects the same script into `<head>` (presence-checked) on pages that have no island to emit it.
 * Client / no-request → false (SSR already emitted).
 */
export function claimRuntimeEmit(): boolean {
	try {
		const event = get_request_event() as object;
		if (runtime_claimed.has(event)) return false;
		runtime_claimed.set(event, true);
		return true;
	} catch {
		return false; // ok: client / no request: SSR already emitted, as said above
	}
}

/** Each request's noted `load` hole endpoints, by its `Request`: the render's event and the handle's
 *  are not one object, the request they carry is. */
const early_holes = new WeakMap<Request, Set<string>>();

/**
 * Note a top-level `defer: 'load'` hole's endpoint for this request: the head starts its request
 * during the parse (early-holes.ts), written once by the handle or `document()`, which take the
 * list. Identical holes share one endpoint, and one request. Client / no-request: nothing to note.
 */
export function note_early_hole(endpoint: string): void {
	try {
		const { request } = get_request_event() as { request: Request };
		let seen = early_holes.get(request);
		if (!seen) early_holes.set(request, (seen = new Set()));
		seen.add(endpoint);
	} catch {
		// ok: no request (the client, a build step): no head to start it from
	}
}

/** This request's noted `load` hole endpoints, taken once (the head that writes them). `request`: the
 *  one the caller holds (the handle's event); else the current render's. */
export function take_early_holes(request?: Request): string[] {
	if (!request)
		try {
			request = (get_request_event() as { request: Request }).request;
		} catch {
			return []; // ok: no request, so no hole of it was noted
		}
	const seen = early_holes.get(request);
	if (!seen) return [];
	early_holes.delete(request);
	return [...seen];
}
