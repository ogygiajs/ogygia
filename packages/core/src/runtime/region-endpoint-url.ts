import { clock } from '@ogygia/machine';
import type { HoleRefusal } from '../contract/runtime-hooks.ts';
import { preload_island_graph } from './island-graph-preload.ts';
import { LoadSlot } from './load-scheduler.ts';
import { class_at, fetch_priority_of, PRIORITY, type LoadClass } from './load-class.ts';
import { flights, STALE, type Flights } from '@ogygia/machine';
import { entry_location } from './entry-locations.ts';
import { import_file } from './import-again.ts';
import { cache } from '@ogygia/machine';

/** Hoisted (hot paths — connectedCallback/hydrate run per region); shared with core's
 *  foreign-origin checks. */
export const ABSOLUTE_URL_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:/i;

// (the same-origin checks are the HTML sink's gate: ./html-sink.ts)
export { is_allowed_region_endpoint, is_same_origin_response } from './html-sink.ts';

/** How far this browser's clock may run behind the server's and still see an expiry. */
const CLOCK_SKEW_SEC = 300;

/**
 * Has this hole's capability (probably) EXPIRED — worth one retry with `&renew=1` after a 403? Its
 * document outlived it in a cache (server/shared-cache.ts). Read from the signed `exp` in the URL,
 * with {@link CLOCK_SKEW_SEC} of slack for a slow clock; a URL that has not expired never renews
 * (the server refuses it), so a wrong guess costs one refused request.
 */
export function capability_expired(
	endpoint: string,
	now_ms: number = Date.now(), // wall: against the server's signed epoch `exp`
	page_origin: string = location.origin
): boolean {
	try {
		const exp = Number(new URL(endpoint, page_origin).searchParams.get('exp'));
		return Number.isFinite(exp) && exp > 0 && exp <= now_ms / 1000 + CLOCK_SKEW_SEC;
	} catch {
		return false;
	}
}

/** The renewal request for an expired capability `endpoint` (the handle re-signs it, anonymous
 *  holes only, and answers the fresh capability in `x-ogygia-capability`). */
export function renewal_url(endpoint: string): string {
	return endpoint + (endpoint.includes('?') ? '&' : '?') + 'renew=1';
}

/** A whole HTML document starts with a doctype or `<html>`; a region answer never does. */
const DOCUMENT_START_RE = /^\s*(?:<!doctype\b|<html\b)/i;

/**
 * Is this hole answer a WHOLE DOCUMENT rather than the region's fragment? ogygia's handle answers a
 * region request in place — a fragment, a 204, an error status — never with a page. A page here
 * means a handle in front of `ogygia.handle()` took the request instead (an auth wall, a locale
 * bounce, a 404 handler) and the browser followed it: a customer's signed-in visitors had every
 * hole of the header filled with the account area's page — its scripts, its skeletons, a second
 * header. Refused, the fallback stands; the redirect twin is {@link is_redirected_answer}.
 */
export function is_document_answer(text: string): boolean {
	return DOCUMENT_START_RE.test(text.slice(0, 256));
}

/** A region request that was redirected (same origin — cross-origin is refused earlier) did not
 *  reach the endpoint it named: whatever answered is not the region. */
export function is_redirected_answer(res: Response): boolean {
	return res.redirected === true;
}

/**
 * Why a hole's answer was refused:
 * - `redirected` / `document`: something in front of ogygia's handle answered instead;
 * - `forbidden`: the handle refused the capability (a 403, `deny` says why — `foreign-key` when the
 *   page and the islands endpoint came from different deployments).
 */
export type RegionRefusal = HoleRefusal;

/** The error a refused answer throws: the fetch loop does not retry it (the answer is
 *  deterministic — a redirect rule, a refused capability, not a flaky network) and DEV names the
 *  culprit. */
export class RegionAnswerRefused extends Error {
	override name = 'RegionAnswerRefused';
	readonly reason: RegionRefusal;
	readonly final_url: string;
	/** `forbidden`: the server's `x-ogygia-deny`, with its key fingerprint and the capability's */
	readonly deny?: string;

	constructor(reason: RegionRefusal, final_url: string, deny?: string) {
		super(`region answer refused: ${reason}${deny ? ` (${deny})` : ''} (${final_url})`);
		this.reason = reason;
		this.final_url = final_url;
		this.deny = deny;
	}
}

/** The error a 429 throws: the endpoint's budget for this visitor is spent. `wait_ms`: how long its
 *  `Retry-After` says to wait, or null when it sent none (a proxy's 429, a server without one). */
export class RegionAnswerLater extends Error {
	override name = 'RegionAnswerLater';
	readonly wait_ms: number | null;

	constructor(wait_ms: number | null, url: string) {
		super(`region answer: 429 Too Many Requests (${url})`);
		this.wait_ms = wait_ms;
	}
}

/** A response's `Retry-After` in ms: delta-seconds, or an HTTP date; null when absent or unreadable. */
export function retry_after_ms(res: Response): number | null {
	const v = res.headers.get('retry-after')?.trim();
	if (!v) return null;
	if (/^\d+$/.test(v)) return Number(v) * 1000;
	const at = Date.parse(v);
	// wall: an HTTP date is a moment on the wall clock
	return Number.isNaN(at) ? null : Math.max(0, at - clock.wall());
}

/** The reason a 403 without `x-ogygia-deny` gets: ogygia's handle never answered it. */
export const NOT_OGYGIA_403 =
	'not ogygia: a proxy, CDN or firewall in front answered (a 403 without x-ogygia-deny)';

/**
 * A 403 from the islands endpoint, as one line: its `x-ogygia-deny` reason, and for `foreign-key`
 * the two keys (the capability's `&k=`, the answering server's `x-ogygia-key`). A 403 with no reason
 * came from something in front of the handle (a bot wall), or from a server before reasons.
 */
export function deny_of(res: Response, endpoint: string): string {
	const why = res.headers.get('x-ogygia-deny');
	if (why === null) return NOT_OGYGIA_403;
	if (why !== 'foreign-key') return why;
	let minted = '';
	try {
		minted = new URL(endpoint, location.href).searchParams.get('k') ?? '';
	} catch {
		// ok: the endpoint parsed to be fetched; the diagnosis goes without its key otherwise
	}
	return `foreign-key: signed by ${minted || '?'}, answered by ${res.headers.get('x-ogygia-key') ?? '?'}`;
}

/**
 * Normalize a hydrate `entry` for `import()`.
 *
 * Root-absolute paths (`/@id/…`, `/_app/…`) and absolute URLs import as-is. Relative specs
 * (`./_app/…`, `../_app/…`) must resolve against the **document** URL — `import()` would
 * otherwise resolve them against the runtime module (`/_app/immutable/og-runtime.*`)
 * and produce `/_app/_app/…` 404s on nested routes.
 */
export function island_module_url(entry: string, base?: string): string {
	if (!entry) return entry;
	// its LOCATION, once the server named one (entry-locations.ts); else the identity as written
	const located = entry_location(entry, base);
	if (located) return located;
	if (entry.startsWith('/') || ABSOLUTE_URL_SCHEME.test(entry)) return entry;
	const b = base ?? location.href;
	const key = b + '\n' + entry;
	const hit = module_urls.get(key);
	if (hit !== undefined) return hit;
	const resolved = new URL(entry, b);
	const out = resolved.pathname + resolved.search + resolved.hash;
	module_urls.set(key, out);
	return out;
}
/** A relative entry resolved against its document, by base + entry (asked on every wake and warm;
 *  the least recently asked go first). */
const module_urls = cache<string, string>({ name: 'island module urls', max: 4000 });

// ── the ONE island-module warmer ─────────────────────────────────────────────
// Every "get this island's JS into the module cache before it's needed" call site funnels here:
// the router's next-page prefetch warm, core's visible-island idle warm, and the interaction
// feature's pointerenter warm. One URL-level dedupe set replaces three inconsistent schemes
// (`import()` is idempotent, but re-parsing the specifier on every hover isn't free). A failed
// warm is not kept, so the real wake — or a later warm — retries; warming is never fatal.
/** A warm's ask: the module's key, and the file it names as the caller that started it spelled it. */
type Warm = { key: string; entry: string; base: string | undefined; url: string };
/** One warm per module, kept once it landed: a warm with a more urgent class joining one raises it
 *  (#437: still queued, it starts now at that class; started, its graph links are raised). Made at
 *  the first warm: a module that only checks an endpoint makes none. */
let warm_flights: Flights<Warm, unknown, Pick<Warm, 'key'>> | undefined;
const warms = () => (warm_flights ??= make_warms());
const make_warms = () =>
	flights.keyed<Warm>()({
		name: 'island warm',
		key: ['key'],
		ignore: {
			entry: 'the module the key names, as the warm that started it spelled it',
			base: 'what that spelling resolves against',
			url: 'the key before it was made absolute'
		},
		run: async ({ entry, base, url }, _signal, flight) => {
			// a warm is the load scheduler's to time (load-scheduler.ts): a hover is the visitor's, a page
			// prefetch's warm is speculative
			const slot = new LoadSlot({
				kind: 'code',
				cls: class_at(flight.priority),
				label: entry,
				flight
			});
			const release = await slot.ready;
			try {
				// the whole graph with the entry, at the class it started with; a later raise lifts it
				preload_island_graph(entry, base, fetch_priority_of(slot.cls()));
				flight.onRaise((p) => preload_island_graph(entry, base, fetch_priority_of(class_at(p))));
				// (through the file's loader the island's own load uses: a warm that failed leaves the load a
				// fresh URL to ask, not the failed one — #261)
				return await import_file(url);
			} catch {
				return STALE; // ok: a warm that failed is not kept (STALE); the island's own load asks again and says its failure
			} finally {
				release();
			}
		}
	});

/** Test seam: forget every warm (a fresh document). */
export function reset_island_warms(): void {
	warm_flights?.drop(() => true);
	warm_flights = undefined;
}

/** The warmer's key: the resolved module as an absolute URL (a location arrives absolute, an href
 *  off a page root-relative — the same file must be one key). */
function warm_key(url: string): string {
	try {
		return new URL(url, location.href).href;
	} catch {
		return url;
	}
}

/** Fire-and-forget `import()` of an island's module, deduped by resolved URL. */
export function warm_island_module(
	entry: string,
	base?: string,
	cls: LoadClass = 'speculative'
): void {
	const url = island_module_url(entry, base);
	if (!url) return;
	// a build's identity with no known location names no file: the load finds it (import_entry)
	if (!entry_location(entry, base) && url.includes('/ogygia/og-region.')) return;
	void warms().get({ key: warm_key(url), entry, base, url }, { priority: PRIORITY[cls] }); // ok: a warm that failed answers STALE, never rejects: nothing to hear
}

/** Has this island module already been warmed (or imported through the warmer)? `entry` resolves
 *  the way `warm_island_module` resolves it; `base` for an href read off a foreign document. */
export function is_warmed_module(entry: string, base?: string): boolean {
	const url = island_module_url(entry, base);
	return !!url && warm_flights?.peek({ key: warm_key(url) }) !== undefined;
}
