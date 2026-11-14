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
	/** open `<template>` elements */
	templates: number;
	/** the end of the last chunk read that its own markup left open (a tag, a comment, a raw-text
	 *  element): read again in front of the next chunk, so it reads as the browser does */
	carry: string;
	/** the page's open elements, as the parser keeps them */
	tags: PageTags;
}

export function scan_state(region: boolean): ScanState {
	return {
		in_body: region,
		regions: [],
		foreign: 0,
		open: null,
		pending: [],
		templates: 0,
		carry: '',
		tags: []
	};
}

const NONE: Matcher = { test: () => false, needles: [] };

const RAW_TEXT: ReadonlySet<string> = new Set([
	'script',
	'style',
	'textarea',
	'title',
	'xmp',
	'iframe',
	'noembed',
	'noframes',
	'noscript',
	'plaintext'
]);

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
	/** the chunk ends where a script may go: outside every region, matched element, template,
	 *  svg or math, and outside any tag, comment or raw text (`false` when it was not read) */
	safe: boolean;
}

const NOTHING: Scanned = { spans: [], split: null, safe: false };

/** May this chunk hold a match? A few native searches: a chunk that answers no is not read until a
 *  later chunk has one (what it opened or closed then decides that chunk's reading). */
export function may_match(html: string, m: Matcher, state: ScanState): boolean {
	if (state.open !== null) return true;
	if (m.needles === null) return html.indexOf('-') !== -1;
	for (const n of m.needles) if (html.indexOf(n) !== -1) return true;
	if (state.pending.length === 0) return false;
	for (const n of m.needles) if (across(state.pending, html, n)) return true;
	return false;
}

/** Does `n` start in the chunks not read yet and end in `html`? */
function across(pending: readonly string[], html: string, n: string): boolean {
	let before = '';
	for (let i = pending.length - 1; i >= 0 && before.length < n.length - 1; i--)
		before = pending[i] + before;
	return `${before.slice(1 - n.length)}${html.slice(0, n.length - 1)}`.indexOf(n) !== -1;
}

/**
 * The outermost elements of `html` that `m` matches, read as the browser reads them, continuing
 * from `state` (updated for the next chunk). In a document, an element counts from `<body` on.
 * `csr`: the body is Svelte's (a Kit-hydrated page), lakes and holes aside.
 */
export function scan(
	html: string,
	m: Matcher,
	state: ScanState,
	csr: boolean,
	force = false
): Scanned {
	if (!force && state.carry === '' && !may_match(html, m, state)) {
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

function read(chunk: string, m: Matcher, state: ScanState, csr: boolean): Scanned {
	const offset = state.carry.length;
	const html = offset ? `${state.carry}${chunk}` : chunk;
	state.carry = '';
	const spans: Span[] = [];
	let open = state.open;
	let start = -1;
	let owned = false;
	let carry_from = -1;
	let raw_from = -1;
	let context: readonly string[] = [];
	for (const at = new MarkupCursor(html); at.next();) {
		carry_from = -1;
		if (at.kind === 0) carry_from = at.raw ? raw_from : opens_at(html, at.start, at.end);
		else if (at.kind === 2) raw_from = -1;
		if (at.kind === 1) {
			const name = tag_name(html, at.start + 1, at.ne);
			if (RAW_TEXT.has(name)) carry_from = raw_from = at.start;
			if (open !== null) {
				if (name === open.name) open.depth++;
				continue;
			}
			if (name === 'svg' || name === 'math') {
				if (html.charCodeAt(at.end - 2) !== 47) state.foreign++;
				continue;
			}
			if (state.foreign > 0) continue;
			if (name === 'template') state.templates++;
			else if (name === 'body') state.in_body = true;
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
				else if (name === 'template' && state.templates > 0) state.templates--;
				page_close(state.tags, name);
			}
		}
	}
	state.open = open;
	if (carry_from !== -1) state.carry = html.slice(carry_from);
	const safe =
		carry_from === -1 &&
		open === null &&
		state.regions.length === 0 &&
		state.foreign === 0 &&
		state.templates === 0;
	let split = open !== null && start !== -1 ? open.name : null;
	const own: Span[] = [];
	for (const s of spans)
		if (s.start >= offset) own.push({ ...s, start: s.start - offset, end: s.end - offset });
		else split ??= s.name;
	return { spans: own, split, safe };
}

function opens_at(html: string, from: number, to: number): number {
	if (to !== html.length) return -1;
	for (let lt = html.indexOf('<', from); lt !== -1 && lt < to; lt = html.indexOf('<', lt + 1)) {
		if (lt + 1 === to) return lt;
		const c = html.charCodeAt(lt + 1) | 32;
		if ((c >= 97 && c <= 122) || c === 33 || c === 47 || c === 63) return lt;
	}
	return -1;
}
