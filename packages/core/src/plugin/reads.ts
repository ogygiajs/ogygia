/**
 * READS: what a render read that is not the same for every visitor, or for every page (its read set).
 * A cache keeps a render only for the callers it is the same for (server/render-cache.ts, a plugin's
 * page store). Every way ogygia learns of such a read notes it here, and nowhere else:
 *
 * - a flag decided for the visitor (`@ogygia/flags`), a streamed load, a plugin's `ctx.perVisitor`;
 * - a cookie, personal header or `locals` value the render saw ({@link observe_reads});
 * - the `page.data` a hole's tree read (server/render-page.ts).
 *
 * A request's facts hold its read set (`facts.reads`). Work that may be kept (a cached hole render)
 * runs in its own set under it (server/read-trace.ts): a read lands in the innermost set and in every
 * set around it, so a hole rendered into a page makes that page per-visitor too.
 */
import type { RequestEvent } from '@sveltejs/kit';

/** One render's read set (and, through its parent, the sets around it). A plain shape, not a class:
 *  core's own types and its built types (and a plugin's copy of this module) must agree on it. */
export interface Reads {
	/** The first per-visitor input read (`flag:<name>`, `cookie:<name>`, `header:<name>`,
	 *  `locals.<key>`, a plugin's reason), or null. */
	readonly perVisitor: string | null;
	/** The render read `page.data`: its output is one page's. */
	readonly pageData: boolean;
	/** A per-visitor input was read (the first one names the set). */
	visitor(input: string): void;
	/** `page.data` was read. */
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
	/** server/read-trace.ts: the read set of the work running now, or undefined outside one */
	open: (() => Reads | undefined) | null;
}
// (one global slot: a plugin package and core can be two module instances of this file)
const slot: ReadsSlot = ((globalThis as Record<symbol, ReadsSlot | undefined>)[
	Symbol.for('ogygia.reads.v1')
] ??= { open: null });

/** Core only (server/read-trace.ts): how the read set of the running work is found. */
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
	// (the running work's set already passes it up to the request's when it is under it)
	request_reads.visitor(input);
}

/** Personal request headers: reading one is a per-visitor read. Everything else (host,
 *  sec-fetch-*, accept-encoding, …) is delivery plumbing. */
const PERSONAL_HEADERS: ReadonlySet<string> = new Set([
	'cookie',
	'authorization',
	'accept-language',
	'user-agent',
	'referer',
	'x-user',
	'x-user-id',
	'x-session',
	'x-session-id'
]);

/** Default-valued reads are the same for everyone: undefined/null/''/false, an empty plain object,
 *  an empty array. (The cookie-less render: what a visitor without the cookie or user sees.) */
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
 * Note the event's personal reads from now on: a cookie, a personal header or a `locals` value that
 * is not its default. Patches `event.cookies.get`/`getAll`, the request's `headers.get` and
 * `event.locals` in place (Kit and its WeakMap-keyed internals keep the same objects), once per
 * request. A read lands in the read set of the work running then, and in the request's.
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

	const headers = event.request.headers;
	const header = headers.get.bind(headers);
	headers.get = ((name: string) => {
		const value = header(name);
		if (value !== null && PERSONAL_HEADERS.has(name.toLowerCase()))
			note(`header:${name.toLowerCase()}`);
		return value;
	}) as typeof headers.get;

	// (SvelteKit 3 types `locals` as readonly; at runtime it is a plain property on both 2 and 3)
	(event as { locals: App.Locals }).locals = new Proxy(event.locals, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof prop === 'string' && !is_default_value(value) && typeof value !== 'function')
				note(`locals.${prop}`);
			return value;
		}
	});
}
