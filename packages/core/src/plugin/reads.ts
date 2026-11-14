import type { RequestEvent } from '@sveltejs/kit';
import { slot as shared } from '@ogygia/machine';

/**
 * One render's read set: what it read that is not the same for every visitor, or for every page. A
 * cache keeps a render only for the callers it is the same for (server/render-cache.ts, a plugin's
 * page store). Every way ogygia learns of such a read notes it in one:
 *
 * - a flag decided for the visitor (`@ogygia/flags`), a streamed load, a plugin's `ctx.perVisitor`;
 * - a cookie, personal header, `locals` value, client address, platform value or credentialed
 *   `fetch` the render saw ({@link observe_reads});
 * - the `page.data` or `page.url` a hole's tree read (server/render-page.ts). The page is the
 *   render's identity, not the visitor's: ogygia's own look-up of it is no read at all.
 *
 * A request's facts hold its read set (`facts.reads`). Work that may be kept (a cached hole render)
 * runs in its own set under it, its `parent` (server/read-trace.ts): a read lands in the innermost
 * set and in every set around it, so a hole rendered into a page makes that page per-visitor too.
 * A plain shape, not a class: core's own types and its built types (and a plugin's copy of this
 * module) must agree on it.
 */
export interface Reads {
	/** The first per-visitor input read (`flag:<name>`, `cookie:<name>`, `header:<name>`,
	 *  `locals.<key>`, a plugin's reason), or null. */
	readonly perVisitor: string | null;
	/** The render read its page (`page.data`, or the url of the page it renders for): its output
	 *  is one page's. */
	readonly pageData: boolean;
	/** A per-visitor input was read (the first one names the set). */
	visitor(input: string): void;
	/** The render's page was read. */
	page(): void;
}

/** A new read set inside `parent` (its reads pass up to it). */
export function read_set(parent: Reads | null = null): Reads {
	let per_visitor: string | null = null;
	let page_data = false;
	return {
		get perVisitor() {
			return per_visitor;
		},
		get pageData() {
			return page_data;
		},
		visitor(input) {
			if (per_visitor === null) per_visitor = input;
			parent?.visitor(input);
		},
		page() {
			page_data = true;
			parent?.page();
		}
	};
}

interface ReadsSlot {
	open: (() => Reads | undefined) | null;
}
const slot = shared<ReadsSlot>({ name: 'ogygia.reads', version: 1, make: () => ({ open: null }) });

/** Core only (server/read-trace.ts): how the read set of the running work is found. One slot for
 *  the process, so a plugin package and core that load two copies of this module share it. */
export function set_open_reads(fn: (() => Reads | undefined) | null): void {
	slot.open = fn;
}

/** The read set of the work running now (a cached render's own), or undefined outside one. */
export function open_reads(): Reads | undefined {
	return slot.open?.();
}

/** A per-visitor read by `request`'s code: into the running work's set and the request's. */
export function note_visitor_read(request_reads: Reads, input: string): void {
	const open = open_reads();
	open?.visitor(input);
	request_reads.visitor(input);
}

// static: a fixed list of header names
const PERSONAL_HEADERS: ReadonlySet<string> = new Set([
	'cookie',
	'authorization',
	'proxy-authorization',
	'accept-language',
	'user-agent',
	'referer',
	'forwarded',
	'x-forwarded-for',
	'x-forwarded-host',
	'x-real-ip',
	'x-client-ip',
	'x-api-key',
	'x-user',
	'x-user-id',
	'x-session',
	'x-session-id'
]);
const PERSONAL_HEADER_RE =
	/client-ip|connecting-ip|(?:^|-)ip(?:-|$)|country|city|geo|latitude|longitude|postal|timezone|session|auth|token|user-id/;

function is_personal_header(name: string): boolean {
	const n = name.toLowerCase();
	return PERSONAL_HEADERS.has(n) || PERSONAL_HEADER_RE.test(n);
}

// static: the platform members every request shares
const SHARED_PLATFORM: ReadonlySet<string> = new Set(['env', 'caches']);
// static: the platform context members every request shares
const SHARED_PLATFORM_CONTEXT: ReadonlySet<string> = new Set([
	'waitUntil',
	'passThroughOnException'
]);

function is_default_value(value: unknown): boolean {
	if (value === undefined || value === null || value === '' || value === false) return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === 'object') {
		const proto = Object.getPrototypeOf(value);
		if (proto === Object.prototype || proto === null) {
			return Object.keys(value as Record<string, unknown>).length === 0;
		}
	}
	return false;
}

const observed = new WeakSet<Request>();

/**
 * Note the event's personal reads from now on: a cookie, a personal header (by name, by `has`, or
 * the headers read whole while one is there, a clone's too), a `locals` value that is not its
 * default (a function there included), the client address, per-request `platform` data, and a
 * `fetch` Kit sends the visitor's credentials with. A default (`undefined`, `null`, `''`, `false`,
 * an empty plain object or array) is the same for everyone: what a visitor without the cookie or
 * user sees. A personal header is one of a fixed list (`cookie`, `authorization`,
 * `accept-language`, `user-agent`, `referer`, the forwarding and `x-user` / `x-session` ones) or one a
 * host or proxy adds per visitor (the client's address, where it is, who it is); the rest (`host`,
 * `sec-fetch-*`, `accept-encoding`, …) is delivery plumbing. Of `platform`, only the app's bindings
 * (`env`, `caches`) and the hand-off for work past the response are the same for every request.
 * Patches `event.cookies.get`/`getAll`, the
 * request's headers and `clone`, and `event.locals`/`fetch`/`getClientAddress`/`platform` in place
 * (Kit and its WeakMap-keyed internals keep the same objects), once per request. A read lands in the
 * read set of the work running then, and in the request's. Every kind is a case in
 * packages/postrender/test/postrender.test.ts › "every way a render reaches the visitor …".
 *
 * Blind spots: reads made before this runs (an upstream handle that primes `locals`: the render's
 * read of `locals` is seen instead), and the clock or randomness.
 */
export function observe_reads(event: RequestEvent, request_reads: Reads): void {
	if (observed.has(event.request)) return;
	observed.add(event.request);
	const note = (input: string) => note_visitor_read(request_reads, input);

	const cookies = event.cookies;
	const get = cookies.get.bind(cookies);
	const get_all = cookies.getAll.bind(cookies);
	cookies.get = ((name: string, opts?: never) => {
		const value = get(name, opts);
		if (!is_default_value(value)) note(`cookie:${name}`);
		return value;
	}) as typeof cookies.get;
	cookies.getAll = ((opts?: never) => {
		const all = get_all(opts);
		if (all.length > 0) note('cookies.getAll');
		return all;
	}) as typeof cookies.getAll;

	watch_request(event.request, note);

	(event as { locals: App.Locals }).locals = new Proxy(event.locals, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			// (a function there is a getter of the visitor's data: a session's `auth()`)
			if (typeof prop === 'string' && !is_default_value(value)) note(`locals.${prop}`);
			return value;
		},
		has(target, prop) {
			const there = Reflect.has(target, prop);
			if (there && typeof prop === 'string' && !is_default_value(Reflect.get(target, prop)))
				note(`locals.${prop}`);
			return there;
		},
		ownKeys(target) {
			const keys = Reflect.ownKeys(target);
			for (const k of keys)
				if (typeof k === 'string' && !is_default_value(Reflect.get(target, k))) {
					note(`locals.${k}`);
					break;
				}
			return keys;
		}
	});

	const fetch = event.fetch;
	const credentialed = has_personal(event.request.headers, ['cookie', 'authorization']);
	if (typeof fetch === 'function')
		(event as { fetch: typeof fetch }).fetch = ((input, init) => {
			// Kit's fetch sends the visitor's cookies to its own origin and its subdomains
			if (credentialed && carries_cookies(event.url, input)) note('fetch:credentials');
			// port-ok: Kit's own event.fetch, wrapped (the platform's goes through the network port)
			return fetch(input, init);
		}) as typeof fetch;

	const address = event.getClientAddress;
	if (typeof address === 'function')
		(event as { getClientAddress: () => string }).getClientAddress = () => {
			note('client-address');
			return address();
		};

	const platform = event.platform as Record<string, unknown> | undefined;
	if (platform && typeof platform === 'object')
		(event as { platform: unknown }).platform = per_request(
			platform,
			SHARED_PLATFORM,
			(key) => {
				if (key === 'context' || key === 'ctx') return SHARED_PLATFORM_CONTEXT;
				return null;
			},
			'platform',
			note
		);
}

/** `headers` holds any of `names` (or, with none given, any personal header). */
function has_personal(headers: Headers, names?: readonly string[]): boolean {
	if (names) return names.some((n) => Headers.prototype.has.call(headers, n));
	for (const [name] of Headers.prototype.entries.call(headers))
		if (is_personal_header(name)) return true;
	return false;
}

/** A request `fetch(input)` makes from a render at `page`: Kit sends it the visitor's cookies. */
function carries_cookies(page: URL, input: RequestInfo | URL): boolean {
	let target: URL;
	try {
		target = new URL(input instanceof Request ? input.url : String(input), page);
	} catch {
		return false; // ok: a URL Kit cannot fetch carries nothing
	}
	if (target.origin === page.origin) return true;
	return target.protocol === page.protocol && target.hostname.endsWith(`.${page.hostname}`);
}

/** Watch `request`'s headers, and those of every clone of it. */
function watch_request(request: Request, note: (input: string) => void): void {
	const headers = request.headers;
	const get = headers.get.bind(headers);
	const has = headers.has.bind(headers);
	headers.get = ((name: string) => {
		const value = get(name);
		if (value !== null && is_personal_header(name)) note(`header:${name.toLowerCase()}`);
		return value;
	}) as typeof headers.get;
	headers.has = ((name: string) => {
		const there = has(name);
		if (there && is_personal_header(name)) note(`header:${name.toLowerCase()}`);
		return there;
	}) as typeof headers.has;
	// reading them all (a copy into a new Headers or Request, entries, a loop) reads the personal ones
	const all = () => {
		if (has_personal(headers)) note('headers');
	};
	for (const method of ['entries', 'keys', 'values', 'forEach', Symbol.iterator] as const) {
		const original = (headers as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>)[
			method
		].bind(headers);
		(headers as unknown as Record<PropertyKey, unknown>)[method] = (...a: unknown[]) => {
			all();
			return original(...a);
		};
	}
	const clone = request.clone.bind(request);
	request.clone = () => {
		const copy = clone();
		watch_request(copy, note);
		return copy;
	};
}

/** A view of `target` that notes a read of a member that is not its default and not `shared`;
 *  `inner(key)` names the shared members of a nested object to watch the same way. Functions are
 *  bound to their own object (a platform's methods check their receiver). */
function per_request(
	target: Record<string, unknown>,
	shared: ReadonlySet<string>,
	inner: (key: string) => ReadonlySet<string> | null,
	path: string,
	note: (input: string) => void
): Record<string, unknown> {
	return new Proxy(target, {
		get(t, prop) {
			const value = Reflect.get(t, prop, t);
			if (typeof prop !== 'string') return value;
			const nested = inner(prop);
			if (nested && value && typeof value === 'object')
				return per_request(
					value as Record<string, unknown>,
					nested,
					() => null,
					`${path}.${prop}`,
					note
				);
			if (!shared.has(prop) && !is_default_value(value)) note(`${path}.${prop}`);
			return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
		}
	});
}
