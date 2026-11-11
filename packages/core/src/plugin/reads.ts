import type { RequestEvent } from '@sveltejs/kit';

/**
 * One render's read set: what it read that is not the same for every visitor, or for every page. A
 * cache keeps a render only for the callers it is the same for (server/render-cache.ts, a plugin's
 * page store). Every way ogygia learns of such a read notes it in one:
 *
 * - a flag decided for the visitor (`@ogygia/flags`), a streamed load, a plugin's `ctx.perVisitor`;
 * - a cookie, personal header or `locals` value the render saw ({@link observe_reads});
 * - the `page.data` a hole's tree read (server/render-page.ts).
 *
 * A request's facts hold its read set (`facts.reads`). Work that may be kept (a cached hole render)
 * runs in its own set under it, its `parent` (server/read-trace.ts): a read lands in the innermost
 * set and in every set around it, so a hole rendered into a page makes that page per-visitor too.
 */
export class Reads {
	#per_visitor: string | null = null;
	#page_data = false;
	readonly #parent: Reads | null;

	constructor(parent: Reads | null = null) {
		this.#parent = parent;
	}

	/** The first per-visitor input read (`flag:<name>`, `cookie:<name>`, `header:<name>`,
	 *  `locals.<key>`, a plugin's reason), or null. */
	get perVisitor(): string | null {
		return this.#per_visitor;
	}

	/** The render read `page.data`: its output is one page's. */
	get pageData(): boolean {
		return this.#page_data;
	}

	/** A per-visitor input was read (the first one names the set). */
	visitor(input: string): void {
		if (this.#per_visitor === null) this.#per_visitor = input;
		this.#parent?.visitor(input);
	}

	/** `page.data` was read. */
	page(): void {
		this.#page_data = true;
		this.#parent?.page();
	}
}

interface ReadsSlot {
	open: (() => Reads | undefined) | null;
}
const slot: ReadsSlot = ((globalThis as Record<symbol, ReadsSlot | undefined>)[
	Symbol.for('ogygia.reads.v1')
] ??= { open: null });

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
 * is not its default. A default (`undefined`, `null`, `''`, `false`, an empty plain object or array)
 * is the same for everyone: what a visitor without the cookie or user sees. A personal header is
 * `cookie`, `authorization`, `accept-language`, `user-agent`, `referer` or an `x-user` / `x-session`
 * one; the rest (`host`, `sec-fetch-*`, `accept-encoding`, …) is delivery plumbing. Patches `event.cookies.get`/`getAll`, the request's `headers.get` and
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

	(event as { locals: App.Locals }).locals = new Proxy(event.locals, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof prop === 'string' && !is_default_value(value) && typeof value !== 'function')
				note(`locals.${prop}`);
			return value;
		}
	});
}
