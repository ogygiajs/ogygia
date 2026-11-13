/**
 * federation — the wire: Ed25519 caller signing + verification (audience-bound, nonce'd,
 * replay-guarded), signature-bound visitor claims, W3C trace continuity, the fragment document
 * shapes, and the asset absolutizer. Design: internal/notes/federation.md.
 */
import {
	createPrivateKey,
	createPublicKey,
	createHash,
	sign as ed_sign,
	verify as ed_verify
} from 'node:crypto';
import {
	Needle,
	next_any_tag,
	next_tag,
	OG_MOUNT_MOVED,
	OG_MOVED,
	OGYGIA_GRAPH,
	OGYGIA_RUNTIME,
	tag_name,
	text_of,
	read_capped,
	type BodyRefused,
	type FoundTag
} from '@ogygia/core/internal/server';
import { cache } from '@ogygia/machine';
import { attr, decodeText, html, type Html } from '@ogygia/core/plugin/utils';
import { capability, clock, random, type Capability } from '@ogygia/machine';

// ── paths the handle serves ──────────────────────────────────────────────────────────────────
/** The exposed route table: `GET|POST|… /og/fragment/page?path=…&search=…`. */
export const FRAGMENT_ROUTES_PATH = '/og/fragment/page';
/** Widgets: `GET /og/fragment/<name>?<props>`; `__catalog` = the unsigned manifest. */
export const FRAGMENT_BASE = '/og/fragment/';
/** Thaw notices: `POST /og/thaw` (signed, JSON `{ id, hop, build, tags }`). */
export const THAW_PATH = '/og/thaw';

/** A path that would leave the origin it is set on (`//host`, `/\host`, `\host`). */
export const OFF_SITE_PATH_RE: RegExp = /^(?:[/\\]{2}|\\)/;

// ── headers ──────────────────────────────────────────────────────────────────────────────────
const SIG_HEADER = 'x-og-sig';
const TS_HEADER = 'x-og-ts';
const USER_HEADER = 'x-og-user';
const NONCE_HEADER = 'x-og-n';
/** The call capability: `v1.<signed at + 1 ms>.<nonce>.<Ed25519 signature, base64url>`. */
const CAP_HEADER = 'x-og-cap';
export const DEFAULT_SKEW_MS = 120_000;
/** Default cap on a forwarded fragment/notice body (form posts are small; 1 MiB is generous). */
export const DEFAULT_MAX_BODY: number = 1024 * 1024;

// ── replay defense ───────────────────────────────────────────────────────────────────────────
// A signature is unique per (key, payload) and the payload carries `ts`, so a byte-identical
// REPLAY reuses the same signature — reject one already seen inside its freshness window. Only
// VERIFIED signatures are recorded (an attacker can't grow this without the private key); each is
// kept until its freshness window closes, and at most MAX_SEEN_SIGS (the oldest go first), so it
// stays bounded to (legit rate × window). Process-local by design: audience binding is the
// cross-instance guarantee, this is the same-instance backstop.
const MAX_SEEN_SIGS = 100_000;
const seen_sigs = cache<string, number>({
	name: 'federation replay guard',
	max: MAX_SEEN_SIGS,
	// wall: a signature's expiry is a wall timestamp the signer set
	keep: (expires_at) => expires_at - clock.wall()
});
function replay_seen(sig: string, expires_at: number, now: number): boolean {
	if (seen_sigs.has(sig)) return true;
	// (a signature whose window already closed is not kept: no replay of it can pass the ts check)
	if (expires_at > now) seen_sigs.set(sig, expires_at);
	return false;
}

/** Has a call with this nonce been accepted, by its capability or its legacy signature? Records
 *  it when not: a call signed both ways carries one nonce (`sign_headers`). */
const nonce_seen = (nonce: string, expires_at: number, now: number): boolean =>
	nonce !== '' && replay_seen(`n:${nonce}`, expires_at, now);

/** Visitor claims — who is BROWSING (the caller signature says who is CALLING). Bound into the
 *  signed payload: forging claims means forging the Ed25519 signature. They never transit the
 *  browser — the shell attaches them server-side from its own session. */
export type Claims = Record<string, unknown>;

/** In-process only: verified claims ride the forwarded Request as a Symbol property — an HTTP
 *  caller cannot set a JS symbol, so an app's standalone (unsigned) front door can never smuggle
 *  identity in through a header. */
const CLAIMS = Symbol.for('ogygia.claims');

/** Read the VERIFIED visitor claims in any load / action / endpoint of an exposed router (and in
 *  a widget's `info.user`). `undefined` on the standalone front door and for anonymous calls. */
export function user<T extends Claims = Claims>(c: { request: Request }): T | undefined {
	return (c.request as unknown as Record<symbol, T | undefined>)[CLAIMS];
}

/** Attach verified claims to a forwarded request (in-process, Symbol-keyed). */
export function attach_claims(request: Request, claims: Claims | undefined): void {
	if (claims) (request as unknown as Record<symbol, Claims>)[CLAIMS] = claims;
}

const body_hash = (body?: ArrayBuffer | Uint8Array | null) =>
	createHash('sha256')
		.update(body ? new Uint8Array(body as ArrayBuffer) : new Uint8Array(0))
		.digest('base64');

// ── KeyObject caches ─────────────────────────────────────────────────────────────────────────
// DER parsing dominates the crypto (sign ~48μs fresh vs ~17μs cached). Keys are few and static,
// so cache parsed KeyObjects by their base64 string, capped as a safety valve (the least recently
// used goes first).
const MAX_CACHED_KEYS = 64;
const private_keys = cache<string, ReturnType<typeof createPrivateKey>>({
	name: 'federation private keys',
	max: MAX_CACHED_KEYS
});
const public_keys = cache<string, ReturnType<typeof createPublicKey>>({
	name: 'federation public keys',
	max: MAX_CACHED_KEYS
});
function private_key(b64: string) {
	let k = private_keys.get(b64);
	if (!k) {
		k = createPrivateKey({
			key: Buffer.from(b64, 'base64'),
			format: 'der',
			type: 'pkcs8'
		});
		private_keys.set(b64, k);
	}
	return k;
}
function public_key(b64: string) {
	let k = public_keys.get(b64);
	if (!k) {
		k = createPublicKey({
			key: Buffer.from(b64, 'base64'),
			format: 'der',
			type: 'spki'
		});
		public_keys.set(b64, k);
	}
	return k;
}

// ── the call capability ──────────────────────────────────────────────────────────────────────
// A signed call as a capability (@ogygia/machine): the method, path, body hash and claims as
// length-prefixed fields, the audience, a nonce, and when it was signed. It is minted for 1 ms:
// the receiver's `skewMs` is its whole window (signed within skewMs either way of its own clock),
// as the legacy headers' was. Proved in test/federation.test.ts › "the call capability".
const CALL = { name: 'federation.call', version: 1, ttl: { max: 1 } } as const;

/** A token's nonce and expiry (`v<version>.<expiry ms>.<nonce>.<signature>`, @ogygia/machine). */
const cap_nonce = (token: string): string => token.split('.')[2] ?? '';
const cap_expiry = (token: string): number => Number(token.split('.')[1]);

/** The mint side, one per private key (as cached as its KeyObject). */
const minters = cache<string, Capability>({
	name: 'federation minters',
	max: MAX_CACHED_KEYS
});
function minter(b64: string): Capability {
	let cap = minters.get(b64);
	if (!cap) {
		const key = private_key(b64);
		cap = capability({
			...CALL,
			signer: {
				sign: (m) => ed_sign(null, Buffer.from(m), key).toString('base64url'),
				verify: () => false // (a minter checks nothing: the receiver brings its keys)
			}
		});
		minters.set(b64, cap);
	}
	return cap;
}

/** The check side, one per window (its replay memory is the process's, whatever keys a check
 *  trusts): each token checks once, and a memory full of live ones refuses new calls rather than
 *  forget one. */
const checkers = cache<number, Capability>({
	name: 'federation checkers',
	max: 8
});
function checker(skew: number): Capability {
	let cap = checkers.get(skew);
	if (!cap) {
		cap = capability({
			...CALL,
			skew,
			replay: { max: MAX_SEEN_SIGS },
			signer: { sign: () => '', verify: () => false } // (every check brings its keys)
		});
		checkers.set(skew, cap);
	}
	return cap;
}

const ED25519_SIG_B64URL = /^[A-Za-z0-9_-]{86}$/;

/** Does any of `keys` verify `sig` (canonical base64url of 64 bytes) over `message`? */
function any_key(keys: readonly string[]) {
	return (message: string, sig: string): boolean => {
		if (!ED25519_SIG_B64URL.test(sig)) return false;
		const bytes = Buffer.from(sig, 'base64url');
		if (bytes.toString('base64url') !== sig) return false;
		const msg = Buffer.from(message);
		for (const pk of keys) {
			try {
				if (ed_verify(null, msg, public_key(pk), bytes)) return true;
			} catch {
				// ok: a malformed key entry verifies nothing; the next is tried
			}
		}
		return false;
	};
}

const call_fields = (method: string, pathq: string, bhash: string, claims: string) => [
	method.toUpperCase(),
	pathq,
	bhash,
	claims
];

// The signed payload binds the AUDIENCE (the target host) so a hop signed for one peer cannot be
// replayed at a sibling that trusts the same key. The NONCE makes every signature unique:
// Ed25519 is deterministic, so two identical concurrent requests would otherwise collide with
// the replay guard.
const sig_payload = (
	ts: string,
	method: string,
	pathq: string,
	bhash: string,
	claims: string,
	aud: string,
	nonce: string
) => Buffer.from(`${ts}.${method.toUpperCase()}.${pathq}.${bhash}.${claims}.${aud}.${nonce}`);

/** Caller side: headers proving "the holder of this private key sent EXACTLY this request, to
 *  THIS audience, now". `audience` defaults to the target URL's host. */
export function sign_headers(
	privateKey: string,
	method: string,
	url: URL,
	body?: ArrayBuffer | Uint8Array | null,
	claims?: Claims,
	audience?: string
): Record<string, string> {
	const key = private_key(privateKey);
	const ts = String(clock.wall()); // wall: signed, and checked by the peer's clock
	const pathq = url.pathname + url.search;
	const user_b64 = claims ? Buffer.from(JSON.stringify(claims)).toString('base64') : '';
	const bhash = body_hash(body);
	const aud = audience ?? url.host;
	const cap = minter(privateKey).mint(aud, call_fields(method, pathq, bhash, user_b64), 1);
	// the legacy signature carries the capability's nonce: one call, one identity in the replay
	// memory, whichever of its signatures a receiver checks (test/federation.test.ts › "#822")
	const nonce = cap_nonce(cap);
	const sig = ed_sign(null, sig_payload(ts, method, pathq, bhash, user_b64, aud, nonce), key);
	return {
		[CAP_HEADER]: cap,
		// (the legacy headers, for a peer that does not read the capability yet)
		[TS_HEADER]: ts,
		[NONCE_HEADER]: nonce,
		[SIG_HEADER]: sig.toString('base64'),
		...(user_b64 ? { [USER_HEADER]: user_b64 } : {})
	};
}

// One spelling per signature, so the replay guard (keyed on the header text) sees every copy:
// test/federation.test.ts › "a signature counts once however its base64 is spelled".
const ED25519_SIG_B64 = /^[A-Za-z0-9+/]{86}==$/;

/** The 64 signature bytes, or `null` when `sig` is not their canonical base64. */
function signature_bytes(sig: string): Buffer | null {
	if (!ED25519_SIG_B64.test(sig)) return null;
	const bytes = Buffer.from(sig, 'base64');
	return bytes.toString('base64') === sig ? bytes : null;
}

export interface VerifyConfig {
	/** base64 SPKI DER Ed25519 public keys of AUTHORIZED callers (a list = rotation overlap). */
	publicKeys: readonly string[];
	/** Max clock skew / replay window in ms (default 120s). */
	skewMs?: number;
	/** The audience(s) THIS app answers to. Defaults to the host of the app's `ORIGIN`; with
	 *  neither, every signed call is refused (the request's own Host is never trusted for it). */
	audience?: string | string[];
}

/** The host of the `ORIGIN` the app is configured with (the variable SvelteKit's Node adapter
 *  reads), or `undefined`: the audience an app answers to when it sets none. */
export function configured_audience(): string | undefined {
	const origin = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env?.ORIGIN;
	if (!origin) return undefined;
	try {
		return new URL(origin).host;
	} catch {
		return undefined; // ok: an ORIGIN that is not a URL configures nothing; federate() warns
	}
}

/** A verified call's claims: none, the parsed ones, or null when signed but unparseable. */
function claims_of(user_b64: string): { user?: Claims } | null {
	if (!user_b64) return {};
	try {
		return {
			user: JSON.parse(Buffer.from(user_b64, 'base64').toString()) as Claims
		};
	} catch {
		return null; // signed but unparseable claims = reject
	}
}

/** Receiver side: fresh, valid, non-replayed signature from an authorized caller, bound to THIS
 *  audience? Returns the (signature-bound) visitor claims on success, `null` on any failure. */
export function verify_signed_request(
	cfg: VerifyConfig,
	request: Request,
	url: URL,
	body?: ArrayBuffer | Uint8Array | null
): { user?: Claims } | null {
	const own = cfg.audience ?? configured_audience();
	if (own == null) return null;
	const audiences = ([] as string[]).concat(own);
	const skew = cfg.skewMs ?? DEFAULT_SKEW_MS;
	const user_b64 = request.headers.get(USER_HEADER) ?? '';
	const bhash = body_hash(body);
	const pathq = url.pathname + url.search;
	const token = request.headers.get(CAP_HEADER);
	// A call with the capability is checked by it alone (a bad one is not saved by legacy headers)
	if (token !== null) {
		const fields = call_fields(request.method, pathq, bhash, user_b64);
		const verify = any_key(cfg.publicKeys);
		let checked = false;
		for (const aud of audiences)
			if (checker(skew).check(token, aud, fields, verify).ok) {
				checked = true;
				break;
			}
		if (!checked) return null;
		// the same call, already accepted by its legacy signature (#822)
		if (nonce_seen(cap_nonce(token), cap_expiry(token) + skew, clock.wall())) return null;
		return claims_of(user_b64);
	}
	const ts = request.headers.get(TS_HEADER);
	const sig = request.headers.get(SIG_HEADER);
	if (!ts || !sig) return null;
	const ts_n = Number(ts);
	const now = clock.wall(); // wall: against the sender's signed timestamp
	// a non-numeric ts → NaN; guard it, else `NaN > window` is false and the freshness gate opens
	if (!Number.isFinite(ts_n) || Math.abs(now - ts_n) > skew) return null;
	const nonce = request.headers.get(NONCE_HEADER) ?? '';
	const sig_buf = signature_bytes(sig);
	if (!sig_buf) return null;
	for (const aud of audiences) {
		const payload = sig_payload(ts, request.method, pathq, bhash, user_b64, aud, nonce);
		for (const pk of cfg.publicKeys) {
			try {
				const key = public_key(pk);
				if (!ed_verify(null, payload, key, sig_buf)) continue;
				if (replay_seen(sig, ts_n + skew, now)) return null;
				// the same call, already accepted by its capability (#822)
				if (nonce_seen(nonce, ts_n + skew, now)) return null;
				return claims_of(user_b64);
			} catch {
				// ok: a malformed key entry verifies nothing; the next is tried, and none verifying refuses the call
			}
		}
	}
	return null;
}

/** The raw claims header name — stripped from forwarded requests so nothing downstream can
 *  mistake an unverified header for identity. */
export const USER_HEADER_NAME: typeof USER_HEADER = USER_HEADER;

// ── documents ────────────────────────────────────────────────────────────────────────────────
/** The wire document an exposed route table answers with. */
export interface FragmentDocument {
	status: number;
	/** 3xx target (already in the answering app's OWN base space, e.g. `/cms/posts/1`). */
	location?: string;
	/** The page's title, as plain text (its HTML character references decoded): the shell escapes
	 *  it once where it places it. */
	title: string;
	/** `<link rel="stylesheet">` / `<style>` tags, asset hrefs absolute to the answering origin. */
	css: string[];
	/** HEAD CHANNEL: the page's SEO/social head bits (`<meta>` + canonical links; never
	 *  charset/viewport/http-equiv — those are the shell's). */
	head?: string;
	body: string;
	/** Absolute URL of the answering app's OWN ogygia runtime (a foreign host loads it to wake
	 *  the fragment's islands). */
	runtime?: string;
	/** The answering app's OWN canonical pathname for this page (`base + path`) — the shell files
	 *  its stored page under `p:<peer>:<path>`, so `postrender.invalidate('<path>')` on the peer thaws
	 *  it (see internal/notes/federation.md §3–4). */
	path?: string;
	/** PROVENANCE: the receipt tags this render consumed — its own `s:<id>:<fp>` (og.source) plus
	 *  any `r:…`/`p:…`/`a:…` it adopted from ITS peers (a chain). The consumer prefixes each with
	 *  this peer's name and files its stored page under them. */
	sources?: string[];
	/** The answering app's build id — changes per deploy. */
	build?: string;
	/** OBSERVABILITY: the trace this render belonged to + how long it took. */
	trace?: { trace_id: string; span_id: string };
	server_ms?: number;
}

/** What a named widget (`/og/fragment/<name>`) answers with. */
export interface WidgetDocument {
	html: string;
	origin?: string;
	sources?: string[];
	build?: string;
	trace?: { trace_id: string; span_id: string };
	server_ms?: number;
}

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const is_str = (v: unknown): v is string => typeof v === 'string';
const opt = (v: unknown, is: (v: unknown) => boolean): boolean => v === undefined || is(v);
const is_strs = (v: unknown): boolean => Array.isArray(v) && v.every(is_str);
const is_trace = (v: unknown): boolean =>
	typeof v === 'object' &&
	v !== null &&
	TRACE_ID_RE.test((v as { trace_id?: unknown }).trace_id as string) &&
	SPAN_ID_RE.test((v as { span_id?: unknown }).span_id as string);
const is_ms = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/** The fields a page and a widget document share, each its own type or left out. */
function common_fields(d: Record<string, unknown>): boolean {
	return (
		opt(d.sources, is_strs) &&
		opt(d.build, is_str) &&
		opt(d.trace, is_trace) &&
		opt(d.server_ms, is_ms)
	);
}

/** A parsed peer answer as the page document it is, or null when any field is another type (a
 *  proxy's JSON, a broken peer): a failed hop, never a TypeError later (test/property-peer-answer). */
export function fragment_document(v: unknown): FragmentDocument | null {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
	const d = v as Record<string, unknown>;
	const ok =
		Number.isInteger(d.status) &&
		(d.status as number) >= 100 &&
		(d.status as number) <= 599 &&
		is_str(d.body) &&
		opt(d.location, is_str) &&
		opt(d.title, is_str) &&
		opt(d.css, is_strs) &&
		opt(d.head, is_str) &&
		opt(d.runtime, is_str) &&
		opt(d.path, is_str) &&
		common_fields(d);
	return ok ? (d as unknown as FragmentDocument) : null;
}

/** A parsed peer answer as the widget document it is, or null (as {@link fragment_document}). */
export function widget_document(v: unknown): WidgetDocument | null {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
	const d = v as Record<string, unknown>;
	const ok = is_str(d.html) && opt(d.origin, is_str) && common_fields(d);
	return ok ? (d as unknown as WidgetDocument) : null;
}

// ── W3C trace context ────────────────────────────────────────────────────────────────────────
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const hex = (n: number) => Buffer.from(random.bytes(n)).toString('hex');

/** Continue the caller's trace (same trace-id, fresh span) or mint one. */
export function child_traceparent(incoming?: string | null): {
	traceparent: string;
	trace_id: string;
	span_id: string;
} {
	const m = incoming ? TRACEPARENT_RE.exec(incoming) : null;
	const trace_id = m ? m[1] : hex(16);
	const span_id = hex(8);
	return { traceparent: `00-${trace_id}-${span_id}-01`, trace_id, span_id };
}

// ── asset absolutizing ───────────────────────────────────────────────────────────────────────
const ABSOLUTE_RE = /^[a-z][a-z0-9+.-]*:|^\/\//i;
// (the asset attributes' names in any case (`asset_suffix`) in any case: where an asset ref can be; a tag without one is not read)
const ASSET_ATTR_ANY_CASE = /entry|endpoint|href|src/gi;
const ASSET_PATH_RE = /(?:^|\/)(_app|og)\//;
const ASSET_EXT_RE = /\.(js|css|woff2?)(\?|$)/;

/** One asset ref pinned to `origin`; an app-local link (or an absolute URL) as it is. */
function pin_asset(value: string, origin: string): string {
	if (ABSOLUTE_RE.test(value)) return value;
	if (!ASSET_PATH_RE.test(value) && !ASSET_EXT_RE.test(value)) return value;
	return new URL(value, `${origin}/`).href;
}

// (the attribute's name in any case: where a graph script can be; a script without it is not read)
const GRAPH_ANY_CASE = new RegExp(OGYGIA_GRAPH, 'gi');

/** An island graph's JSON (core island-graph.ts: `{h, e, s}`), every chunk, entry and location in
 *  it pinned to `origin`: the shell's runtime resolves them against ITS page otherwise, so a remote
 *  island's preloads and its portable snippets' locations would name the shell's files. */
function pin_graph(json: string, origin: string): string {
	let wire: { h?: unknown; e?: unknown; s?: unknown };
	try {
		wire = JSON.parse(json);
	} catch {
		return json;
	}
	// (peer HTML: anything that is not a graph object passes through as it came)
	if (!wire || typeof wire !== 'object' || Array.isArray(wire)) return json;
	const pin_keys = (o: unknown) =>
		o && typeof o === 'object'
			? Object.fromEntries(Object.entries(o).map(([k, v]) => [pin_asset(k, origin), v]))
			: o;
	if (Array.isArray(wire.h))
		wire.h = wire.h.map((h) => (typeof h === 'string' ? pin_asset(h, origin) : h));
	wire.e = pin_keys(wire.e);
	if (wire.s && typeof wire.s === 'object')
		wire.s = Object.fromEntries(
			Object.entries(wire.s).map(([k, v]) => [
				pin_asset(k, origin),
				typeof v === 'string' ? pin_asset(v, origin) : v
			])
		);
	// (as the core writes it: `<` escaped, so the text can never close its script)
	return JSON.stringify(wire).replaceAll('<', '\\u003C');
}

/** A region's `endpoint`, pinned to `origin` whatever its path: it is always the answering app's own
 *  (a server island's hole, a lake's), never a link the consumer resolves in its address space. */
function pin_endpoint(value: string, origin: string): string {
	return ABSOLUTE_RE.test(value) ? value : new URL(value, `${origin}/`).href;
}

/** Where the asset name (`entry`, `endpoint`, `href`, `src`, in any ASCII case) that ends
 *  `html[ns, ne)`, an attribute's name as written, starts, or -1. An attribute holds an asset ref
 *  when its name is one, or ends in one after a character no word holds (`data-src`,
 *  `xlink:href`). */
function asset_suffix(html: string, ns: number, ne: number): number {
	// (told apart by their last letter: most names are out there)
	switch (html.charCodeAt(ne - 1) | 32) {
		case 99 /* c */:
			return ends_with(html, ns, ne, 'src') ? ne - 3 : -1;
		case 102 /* f */:
			return ends_with(html, ns, ne, 'href') ? ne - 4 : -1;
		case 121 /* y */:
			return ends_with(html, ns, ne, 'entry') ? ne - 5 : -1;
		case 116 /* t */:
			return ends_with(html, ns, ne, 'endpoint') ? ne - 8 : -1;
		default:
			return -1;
	}
}

/** Are `html[a, a_end)` and `html[b, b_end)` one name as the browser keeps it (ASCII letters in any
 *  case, the rest as written)? */
function same_name(html: string, a: number, a_end: number, b: number, b_end: number): boolean {
	if (a_end - a !== b_end - b) return false;
	for (; a < a_end; a++, b++) {
		let x = html.charCodeAt(a);
		let y = html.charCodeAt(b);
		if (x >= 65 && x <= 90) x += 32;
		if (y >= 65 && y <= 90) y += 32;
		if (x !== y) return false;
	}
	return true;
}

/** Does `html[ns, ne)` end with the lower-case ASCII `suffix`, in any ASCII case? */
function ends_with(html: string, ns: number, ne: number, suffix: string): boolean {
	const len = suffix.length;
	if (ne - ns < len) return false;
	for (let k = 0, at = ne - len; k < len; k++, at++) {
		let c = html.charCodeAt(at);
		if (c >= 65 && c <= 90) c += 32;
		if (c !== suffix.charCodeAt(k)) return false;
	}
	return true;
}

/** Pin ASSET refs (island entries, stylesheets, chunks, the island graph) and region ENDPOINTS to
 *  `origin`; app-local LINKS stay path-relative — the consuming shell owns the address space they
 *  resolve in.
 *
 *  One walk over the real tags (as the browser reads them: text that looks like one, in a comment,
 *  a code sample or script text, is the page's text, #974): the asset refs in their attribute
 *  values, and the JSON of every `script[data-ogygia-graph]` (as the runtime selects them). */
export function absolutize(html: string, origin: string): string {
	const graphs = new Needle(html, GRAPH_ANY_CASE);
	if (graphs.gone && new Needle(html, ASSET_ATTR_ANY_CASE).gone) return html;
	let out = '';
	let pos = 0;
	/** the asset names this tag has had, as spans (a repeat is not the attribute: the first is) */
	const seen: number[] = [];
	const pin_value = (ns: number, ne: number, vs: number, ve: number): void => {
		const suffix = asset_suffix(html, ns, ne);
		if (suffix === -1) return;
		// (the asset name is the whole name, or follows a character no word holds: `data-src`; one
		// past ASCII is none, as the browser keeps it as written, #1115)
		if (suffix > ns) {
			let c = html.charCodeAt(suffix - 1);
			if (c >= 65 && c <= 90) c += 32;
			if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95) return;
		}
		for (let k = 0; k < seen.length; k += 2)
			if (same_name(html, seen[k], seen[k + 1], ns, ne)) return;
		seen.push(ns, ne);
		if (vs === ve) return;
		const value = html.slice(vs, ve);
		const pinned = ne - suffix === 8 ? pin_endpoint(value, origin) : pin_asset(value, origin);
		if (pinned === value) return;
		out += html.slice(pos, vs) + pinned;
		pos = ve;
	};
	let graphs_done = graphs.gone;
	for (let i = 0; ;) {
		// (each tag's attributes are pinned as the walk reads them, first to last; a tag the input
		// ends inside is no tag, and its pins are dropped)
		const out_before = out;
		const pos_before = pos;
		seen.length = 0;
		const t = next_any_tag(html, i, pin_value);
		if (t === null) {
			out = out_before;
			pos = pos_before;
			break;
		}
		i = t.next;
		if (graphs_done) continue;
		const in_graphs = graphs.holds(t);
		if (graphs.gone) graphs_done = true;
		if (!in_graphs || tag_name(html, t) !== 'script' || t.attr(OGYGIA_GRAPH) === undefined)
			continue;
		const json = text_of(html, t, 'script');
		// (a graph whose script never closes ends the graph reads, as it ends the runtime's)
		if (json === null) {
			graphs_done = true;
			continue;
		}
		out += html.slice(pos, t.end) + pin_graph(json, origin);
		pos = t.end + json.length;
	}
	return pos === 0 ? html : out + html.slice(pos);
}

// ── document lifting (an app's full HTML → the wire document) ────────────────────────────────
// (a `rel` holds a token as a browser reads it: split on spaces, in any case)
const STYLESHEET_REL = /(?:^|[\t\n\f\r ])stylesheet(?:[\t\n\f\r ]|$)/i;
const CANONICAL_REL = /(?:^|[\t\n\f\r ])canonical(?:[\t\n\f\r ]|$)/i;

/** The element `tag` (a `<name …>` of `html`) through its end tag: its raw text up to the first
 *  `</name`, then that end tag. Null when it never closes. */
function element_of(html: string, tag: FoundTag, name: string): string | null {
	const text = text_of(html, tag, name);
	if (text === null) return null;
	const gt = html.indexOf('>', tag.end + text.length);
	return gt === -1 ? null : html.slice(tag.start, gt + 1);
}

/** Where the document's last `</body` end tag starts, at or after `from`, or -1. */
function last_body_close(html: string, from: number): number {
	for (let i = html.lastIndexOf('</'); i >= from && i !== -1; i = html.lastIndexOf('</', i - 1)) {
		if (html.slice(i + 2, i + 6).toLowerCase() === 'body') {
			const c = html.charCodeAt(i + 6);
			// (the name ends there: whitespace, `/`, `>`)
			if (c === 62 || c === 47 || c === 32 || (c >= 9 && c <= 13)) return i;
		}
		if (i === 0) break;
	}
	return -1;
}

/** A head meta the fragment carries: SEO/social; charset/viewport/http-equiv stay the shell's
 *  (it owns the document). */
function carried_meta(t: FoundTag): boolean {
	return (
		t.attr('charset') === undefined &&
		t.attr('http-equiv') === undefined &&
		(t.attr('name') ?? '').toLowerCase() !== 'viewport'
	);
}

/** The card a fragment answers with when its peer redirected after the status was sent (a hole,
 *  a streamed mount): a link to the peer's `location`, escaped into its `href` (#439). */
export function moved_card(
	marker: typeof OG_MOVED | typeof OG_MOUNT_MOVED,
	what: 'section' | 'page',
	location: string
): Html {
	return html`<p${attr(marker, true)}>This ${what} moved. <a href="${location}">Continue</a></p>`;
}

/** Lift a full HTML document into the wire shape (title, css, head channel, body, runtime). */
export function lift_document(html: string, origin: string): Omit<FragmentDocument, 'status'> {
	const head_tag = next_tag(html, 'head', 0);
	const head = (head_tag && text_of(html, head_tag, 'head')) ?? '';
	let runtime_src: string | undefined;
	for (let t = next_tag(html, 'script', 0); t !== null; t = next_tag(html, 'script', t.next)) {
		if (t.attr(OGYGIA_RUNTIME) === undefined) continue;
		runtime_src = t.attr('src') || undefined;
		if (runtime_src) break;
	}
	// HEAD CHANNEL: the metas and the canonical link, in the head's order; the stylesheets beside
	let head_meta = '';
	const css: string[] = [];
	let meta = next_tag(head, 'meta', 0);
	let link = next_tag(head, 'link', 0);
	while (meta !== null || link !== null) {
		if (link === null || (meta !== null && meta.start < link.start)) {
			if (carried_meta(meta!)) head_meta += absolutize(head.slice(meta!.start, meta!.end), origin);
			meta = next_tag(head, 'meta', meta!.next);
			continue;
		}
		const rel = link.attr('rel') ?? '';
		if (CANONICAL_REL.test(rel)) head_meta += absolutize(head.slice(link.start, link.end), origin);
		if (STYLESHEET_REL.test(rel)) css.push(absolutize(head.slice(link.start, link.end), origin));
		link = next_tag(head, 'link', link.next);
	}
	for (let t = next_tag(head, 'style', 0); t !== null;) {
		const style = element_of(head, t, 'style');
		if (style === null) break;
		css.push(absolutize(style, origin));
		t = next_tag(head, 'style', t.start + style.length);
	}
	const title_tag = next_tag(head, 'title', 0);
	const body_tag = next_tag(html, 'body', 0);
	const body_end = body_tag === null ? -1 : last_body_close(html, body_tag.end);
	return {
		title: decodeText((title_tag && text_of(head, title_tag, 'title')) ?? ''),
		css,
		...(head_meta ? { head: head_meta } : {}),
		body: absolutize(body_end === -1 ? html : html.slice(body_tag!.end, body_end), origin),
		...(runtime_src ? { runtime: new URL(runtime_src, `${origin}/`).href } : {})
	};
}

// ── JSON responses ───────────────────────────────────────────────────────────────────────────
export const json_response = (
	data: unknown,
	status: number = 200,
	extra?: Record<string, string>
): Response =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json', ...extra }
	});

export const json_error = (status: number, error: string): Response =>
	json_response({ error, status }, status);

/** Read a request body under a cap BEFORE any verification work (an unauthenticated caller must
 *  never stream gigabytes into this process): read no further than the cap, chunked or not
 *  (test/body-cap.test.ts), or why it was not read (never a throw: test/body-unreadable.test.ts). */
export async function read_capped_body(
	request: Request,
	max: number
): Promise<Uint8Array<ArrayBuffer> | undefined | BodyRefused> {
	if (request.method === 'GET' || request.method === 'HEAD') return undefined;
	return read_capped(request, max);
}
