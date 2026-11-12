/**
 * Build a signed region capability URL (same shape as server-island holes).
 * Used by Region's lake branch for `render: 'live'`. Client build gets a stub that returns ''.
 */
import { signing_key } from './signing-key.ts';
import {
	session_cookie,
	region_ttl,
	renew_window,
	sign,
	region_mac_message,
	get_request_event,
	region_url,
	region_render,
	region_css
} from 'ogygia:server';
import { app_path } from '../kit-paths.ts';
import { building } from '$app/env';
import { islands_endpoint, MAX_REGION_PROPS_LEN } from './endpoint.ts';
import { capability_lifetime, type CapabilityLifetime } from './capability-lifetime.ts';
import { encode_region_props } from './region-props.ts';
import { stringify } from 'devalue';
import { record_server_event } from '../events/server-registry.ts';
import { KNOWN_COPIES_CAP, KNOWN_HEADER_CAP } from '../contract/known-copies.ts';

// DEVTOOLS gate — server realm; off → folds out.
const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
// the server's rules (./rules.ts): dev and OGYGIA_RULES=1 builds only, folds out of any other
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);
import { B64Url } from './payload.ts';
import { REF_WIRE_KEY, placed, ref_reducer } from '../ref.ts';
import { ensure_prop_kinds } from './region-props.ts';
import { OgygiaError, warn } from '../messages/server.ts';
import { note_minted_capability } from './rules.ts';

/** A hole's own stylesheet hrefs, by region id — the list its endpoint answer links (hooks.ts
 *  `region_css_links`), for a render that inlines the hole in the page instead (Region.svelte). */
export function hole_css(entry: string): string[] {
	const url = region_url[entry];
	return url ? region_css(url) : [];
}

/** Same families as encode_region_props — one seam law for island props. */
// static: the prop families that cross the wire
const PROP_FAMILIES = new Set(['wire', 'store', 'snippet', 'fn', 'derived']);

/** The request being rendered (null off-request: prerender, a test). */
function current_request(): Request | null {
	try {
		return get_request_event().request;
	} catch {
		return null;
	}
}

/** The app's capability lifetime, bound to its settings: every hole it signs (these, and the
 *  plugins' `app.capability`, which the handle hands it) expires and renews by this one rule. */
export const app_lifetime: CapabilityLifetime = capability_lifetime({
	building,
	region_ttl,
	renew_window,
	request: current_request
});

/** Session sealed into the MAC when `ogygia({ sessionCookie })` is set; empty at prerender. */
function region_session(): string {
	if (!session_cookie) return '';
	try {
		return get_request_event().cookies.get(session_cookie) ?? '';
	} catch {
		return '';
	}
}

/**
 * SERVER-DELTA NAV (D3) — the region copies the CLIENT already has live, sent on an SPA nav via
 * `x-ogygia-known`: one fingerprint per live copy it can reuse (a fingerprint repeats for twins).
 * Honored ONLY on an SPA nav (`x-ogygia-spa`); a full page load has no header → nothing is reused →
 * everything renders. Parsed once per request-event. A missing/oversized header is always the SAFE
 * full render — this is a pure optimization signal.
 */
const KNOWN_COPIES = new WeakMap<object, Map<string, number>>();

/** Did the app opt into server-delta navigation (`router: { serverDelta: true }`)? A build constant
 *  (Vite `define`, the SSR build's too); typeof-guarded, so a plain node import is off. Off, the
 *  server never honors `x-ogygia-known`: any client can send it. */
export function server_delta_on(): boolean {
	return typeof __OGYGIA_SERVER_DELTA__ !== 'undefined' && __OGYGIA_SERVER_DELTA__ === true;
}

/**
 * Whether the region with fingerprint `fp` may be skipped in this response: the app opted into
 * server-delta, and the client holds a live copy of it that no earlier region of this response took.
 * Each call takes one copy, so a page with more copies than the client holds gets the rest rendered
 * (#846): the client pairs each skipped placeholder with one live copy, in document order
 * (runtime/reconcile.ts `stamp_region_keys`). Region.svelte calls it once per region, in render
 * order. Client-stubbed to `false`.
 */
export function reuse_known_region(fp: string): boolean {
	if (!server_delta_on()) return false;
	let event;
	try {
		event = get_request_event();
	} catch {
		return false; // no request scope (prerender / off-request) → render all
	}
	let copies = KNOWN_COPIES.get(event);
	if (copies === undefined) {
		copies = new Map();
		try {
			const spa = event.request.headers.get('x-ogygia-spa');
			const known = spa ? event.request.headers.get('x-ogygia-known') : null;
			// over a cap the browser never passes (contract/known-copies.ts): no claim
			const named = known && known.length <= KNOWN_HEADER_CAP ? known.split(',') : [];
			if (named.length <= KNOWN_COPIES_CAP)
				for (const k of named) copies.set(k, (copies.get(k) ?? 0) + 1);
		} catch {
			// ok: an unreadable header is no claim: everything renders
		}
		KNOWN_COPIES.set(event, copies);
	}
	const left = copies.get(fp) ?? 0;
	if (left === 0) return false;
	copies.set(fp, left - 1);
	return true;
}

/**
 * Shared minting core for signed region capabilities — the ONE source of truth for the
 * `/__ogygia__?id&props&exp&sig` URL, its MAC message, TTL policy, and session sealing. Both held regions
 * (via {@link make_region_endpoint}) and server islands (Region.svelte's server branch) sign through this,
 * each deriving/validating its own `payload` first (held regions degrade to `''` on failure, server
 * islands throw). Given a valid encoded `payload`, the emitted URL/MAC/exp is identical to both.
 *
 * @param entry region id (server-manifest key baked into the MAC)
 * @param payload b64url props blob (already encoded + size-checked by the caller)
 * @param ttl response cache max-age in **seconds** (`0` = no-store, the default). Signed into the MAC
 *   and echoed as a `ttl` query param so the handle sets `Cache-Control` from it — a harvested URL
 *   can't be re-pointed at a longer browser cache.
 * @param wakes the hole's component hydrates over its answer: signed as `w=1`, so the endpoint
 *   renders the answer inside an island, as the hydrate does (#906)
 */
export function mint_region_capability(
	entry: string,
	payload: string,
	ttl = 0,
	wakes = false
): string {
	const session = region_session();
	// The app's one lifetime rule (server/capability-lifetime.ts): prerender-grade on a stored or
	// prerendered page (props are public in the HTML; session sealed empty there), past the shared
	// cache's life for an anonymous hole on a cacheable document, else the short `ttl` window.
	const exp = app_lifetime.mint_expiry(session);
	const key = signing_key();
	// A hole is dynamic by default (`ttl` 0 → the handle answers `no-store`); a positive `ttl` opts
	// into a `private, max-age=ttl` browser cache. Empty string when 0 keeps the MAC field stable.
	const ttl_field = ttl > 0 ? String(Math.floor(ttl)) : '';
	// `r`: what the endpoint renders (the component), signed — a build that no longer has this `id`
	// (another schedule, preset or salt) still answers it (compiler/region/identity.ts `renderId`)
	const render = region_render[entry] ?? '';
	const wakes_field = wakes ? '1' : '';
	const sig = sign(
		key.secret,
		region_mac_message(entry, exp, payload, session, ttl_field, render, wakes_field)
	);
	const ttl_param = ttl_field ? `&ttl=${ttl_field}` : '';
	if (DEVTOOLS)
		record_server_event({ domain: 'server', name: 'server.capability.minted', id: entry, ttl });
	// `k`: the minter's key fingerprint, outside the MAC (server/signing-key.ts)
	// a path from the app's root, never page-relative: the HTML that carries it moves
	const url = `${app_path(islands_endpoint())}?id=${encodeURIComponent(entry)}${render ? `&r=${render}` : ''}&props=${payload}&exp=${exp}${ttl_param}${wakes ? '&w=1' : ''}&sig=${sig}&k=${key.fp}`;
	if (RULES) note_minted_capability(url);
	return url;
}

/**
 * Server-island mint: encode `props` (devalue + wire codec), enforce the size cap (THROW — a server
 * island with oversized/non-serializable props is an author bug the handle would reject anyway), and
 * sign. The one place `Region.svelte`'s `__mode: 'server'` branch signs its hole; routed through the
 * `ogygia:server/region-endpoint` virtual so the client build stubs it to `''` (server islands never
 * mint on the client — the runtime fetches the endpoint). Mirrors the old `ServerIsland.svelte`.
 */
export function mint_server_region(
	entry: string,
	props: Record<string, unknown>,
	ttl = 0,
	/** the hole wakes (`wake` on a `render: 'deferred'` mark) */
	wakes = false
): string {
	ensure_prop_kinds();
	// (decoded fresh at the endpoint, never by id: place form keeps the address the same per render)
	const payload = B64Url.encode(
		placed(stringify(props, { [REF_WIRE_KEY]: ref_reducer(PROP_FAMILIES) }))
	);
	if (payload.length > MAX_REGION_PROPS_LEN) {
		throw new OgygiaError('hole_props_too_large', {
			entry,
			length: payload.length,
			max: MAX_REGION_PROPS_LEN
		});
	}
	return mint_region_capability(entry, payload, ttl, wakes);
}

/** HMAC-signed `<endpoint>?id&props&exp&sig` (`handle({ endpoint })`, default `/__ogygia__`) for re-rendering `entry` with `props`. */
export function make_region_endpoint(
	entry: string,
	props: Record<string, unknown> = {},
	/** the held region wakes (its schedule: the binding's, or the `region()` call's) */
	wakes = false
): string {
	const payload = encode_region_props(props);
	if (payload == null) {
		// Non-serializable or oversized props. Degrading to "no endpoint" makes the region behave
		// like a static lake; throwing would 500 the PAGE. The handle would 403 the same blob.
		warn('live_props_not_serializable', { entry, max: MAX_REGION_PROPS_LEN });
		return '';
	}
	return mint_region_capability(entry, payload, 0, wakes);
}

export { encode_region_props } from './region-props.ts';
/** The island `data-og-fp` (server/fingerprint.ts) — Region.svelte reaches it through this
 *  client-stubbed virtual, so the native digest never enters the client graph. */
export { region_fingerprint } from './fingerprint.ts';
