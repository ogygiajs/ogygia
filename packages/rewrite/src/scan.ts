import { MarkupCursor } from '@ogygia/core/internal/instruments';
import {
	custom_name,
	page_close,
	page_open,
	region_at,
	tag_name,
	type PageTags
} from './reversible.ts';

/** Which element names a rewrite takes: a tag prefix, a list of tags, or a test on the name. */
export type MatchSpec = string | readonly string[] | ((name: string) => boolean);

/** A compiled {@link MatchSpec}: the test on a lower-case name, and the strings a chunk must hold
 *  for any element to match (`null`: no such strings, every chunk is read). */
export interface Matcher {
	test: (name: string) => boolean;
	needles: readonly string[] | null;
}

const MAX_NEEDLES = 8;

export function matcher(spec: MatchSpec): Matcher {
	if (typeof spec === 'function') return { test: spec, needles: null };
	if (typeof spec === 'string') {
		const prefix = spec.toLowerCase();
		return { test: (name) => name.startsWith(prefix), needles: [`<${prefix}`] };
	}
	const names = new Set(spec.map((s) => s.toLowerCase()));
	const needles = names.size <= MAX_NEEDLES ? [...names].map((n) => `<${n}`) : null;
	return { test: (name) => names.has(name), needles };
}

export function union(matchers: readonly Matcher[]): Matcher {
	if (matchers.length === 1) return matchers[0];
	let needles: string[] | null = [];
	for (const m of matchers) {
		if (m.needles === null || needles === null) needles = null;
		else needles.push(...m.needles);
	}
	if (needles !== null && needles.length > MAX_NEEDLES) needles = null;
	return { test: (name) => matchers.some((m) => m.test(name)), needles };
}

/** What a response's earlier chunks leave for the next one to be read in. */
export interface ScanState {
	in_body: boolean;
	/** the open regions, innermost last: `true` for an island (Svelte-owned inside) */
	regions: boolean[];
	/** open svg / math elements */
	foreign: number;
	/** a matched element still open at the end of the last chunk, and how deep in its own name */
	open: { name: string; depth: number } | null;
	/** chunks with no match not read yet: read only when a later chunk has one */
	pending: string[];
	/** the page's open elements, as the parser keeps them */
	tags: PageTags;
}

export function scan_state(region: boolean): ScanState {
	return { in_body: region, regions: [], foreign: 0, open: null, pending: [], tags: [] };
}

const NONE: Matcher = { test: () => false, needles: [] };

/** One outermost matched element of a chunk: its span, its name, and whether it sits in
 *  Svelte-owned markup. */
export interface Span {
	start: number;
	end: number;
	name: string;
	owned: boolean;
	/** the page's open elements around it, outermost first */
	context: readonly string[];
}

export interface Scanned {
	spans: Span[];
	/** the name of a matched element the chunk ends inside, if it started in this chunk */
	split: string | null;
}

const NOTHING: Scanned = { spans: [], split: null };

/** May this chunk hold a match? A few native searches: a chunk that answers no is not read until a
 *  later chunk has one (what it opened or closed then decides that chunk's reading). */
export function may_match(html: string, m: Matcher, state: ScanState): boolean {
	if (state.open !== null) return true;
	if (m.needles === null) return html.indexOf('-') !== -1;
	for (const n of m.needles) if (html.indexOf(n) !== -1) return true;
	return false;
}

/**
 * The outermost elements of `html` that `m` matches, read as the browser reads them, continuing
 * from `state` (updated for the next chunk). In a document, an element counts from `<body` on.
 * `csr`: the body is Svelte's (a Kit-hydrated page), lakes and holes aside.
 */
export function scan(html: string, m: Matcher, state: ScanState, csr: boolean): Scanned {
	if (!may_match(html, m, state)) {
		state.pending.push(html);
		return NOTHING;
	}
	if (state.pending.length) {
		const skipped = state.pending;
		state.pending = [];
		for (const s of skipped) read(s, NONE, state, csr);
	}
	return read(html, m, state, csr);
}

function read(html: string, m: Matcher, state: ScanState, csr: boolean): Scanned {
	const spans: Span[] = [];
	let open = state.open;
	let start = -1;
	let owned = false;
	let context: readonly string[] = [];
	for (const at = new MarkupCursor(html); at.next();) {
		if (at.kind === 1) {
			const name = tag_name(html, at.start + 1, at.ne);
			if (open !== null) {
				if (name === open.name) open.depth++;
				continue;
			}
			if (name === 'svg' || name === 'math') {
				if (html.charCodeAt(at.end - 2) !== 47) state.foreign++;
				continue;
			}
			if (state.foreign > 0) continue;
			if (name === 'body') state.in_body = true;
			else if (name === 'ogygia-region') state.regions.push(region_at(html, at.ne) === 'island');
			if (state.in_body && custom_name(name) && m.test(name)) {
				open = { name, depth: 1 };
				start = at.start;
				const r = state.regions;
				owned = r.length ? r[r.length - 1] : csr;
				context = state.tags.map((t) => t.name);
			} else page_open(state.tags, name, html.charCodeAt(at.end - 2) === 47);
		} else if (at.kind === 2) {
			const name = tag_name(html, at.start + 2, at.ne);
			if (open !== null) {
				if (name === open.name && --open.depth === 0) {
					if (start !== -1) spans.push({ start, end: at.end, name, owned, context });
					open = null;
					start = -1;
				}
				continue;
			}
			if (state.foreign > 0) {
				if (name === 'svg' || name === 'math') state.foreign--;
			} else {
				if (name === 'ogygia-region') state.regions.pop();
				page_close(state.tags, name);
			}
		}
	}
	state.open = open;
	return { spans, split: open !== null && start !== -1 ? open.name : null };
}
