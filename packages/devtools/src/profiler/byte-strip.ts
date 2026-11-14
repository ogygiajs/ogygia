/**
 * THE DOCUMENT AS A BYTE STRIP — what each byte of the HTML the server sent IS: head markup,
 * inline styles, stylesheet links, the runtime bootstrap, other scripts, the page seed, the remote
 * seed, the island props tail, the holes record, each island's markup (named by its fingerprint,
 * the report joins it to the island's row), lakes and holes, declarative shadow DOM a design
 * system rendered, and plain markup. Pure: a string in, ordered segments out. The report draws
 * the strip with the time each byte left the server and the time the browser had it.
 */
import {
	MarkupCursor,
	next_tag,
	OG_FP,
	OGYGIA_HOLES,
	OGYGIA_PROPS,
	OGYGIA_RUNTIME,
	read_tag,
	text_of,
	type FoundTag
} from '@ogygia/core/internal/server';
import { scanRegions } from './regions-scan.ts';

export type StripKind =
	| 'head'
	| 'style'
	| 'css-link'
	| 'runtime'
	| 'script'
	| 'seed'
	| 'remote-seed'
	| 'props'
	| 'holes'
	| 'island'
	| 'lake'
	| 'hole'
	| 'shadow'
	| 'markup';

export interface StripSegment {
	kind: StripKind;
	start: number;
	end: number;
	/** an island's fingerprint / a script's type — what the report names the segment by */
	label?: string;
}

export interface ByteStrip {
	total: number;
	segments: StripSegment[];
	/** bytes per kind over the whole document (shadow DOM counted wherever it sits, islands included) */
	by_kind: Partial<Record<StripKind, number>>;
	/** declarative shadow roots anywhere in the document, bytes — a design system's server render */
	shadow_bytes: number;
	shadow_count: number;
	/** the elements the markup makes: the whole document's, and the islands holding the most */
	elements?: { total: number; islands: { fp: string; n: number }[] };
	/** the `src` of each `<img>` with no width or height (the first 8): room the browser cannot hold */
	unsized_images?: string[];
	/** when each chunk of the document LEFT the server (end offset, ms after the render began) —
	 *  present when the page streamed in more than one chunk */
	chunks?: { end: number; t: number }[];
	/** what held the document open after its early part (stream-tail.ts), when it paused long */
	tail?: import('./stream-tail.ts').StreamTail;
}

/** When a byte left the server, from the chunk stamps: the chunk that carried it. */
export function left_at(offset: number, chunks: { end: number; t: number }[]): number | undefined {
	for (const c of chunks) if (offset < c.end) return c.t;
	return chunks.length ? chunks[chunks.length - 1].t : undefined;
}

// (a `rel` holds a token as a browser reads it: split on spaces, in any case)
const REL_STYLESHEET = /(?:^|[\t\n\f\r ])stylesheet(?:[\t\n\f\r ]|$)/i;

function script_kind(t: FoundTag): { kind: StripKind; label?: string } {
	if (t.attr(OGYGIA_RUNTIME) !== undefined) return { kind: 'runtime' };
	if (t.attr(OGYGIA_PROPS) !== undefined) return { kind: 'props' };
	if (t.attr(OGYGIA_HOLES) !== undefined) return { kind: 'holes' };
	const type = t.attr('type');
	const mime = type?.toLowerCase();
	if (mime === 'application/ogygia-page') return { kind: 'seed' };
	if (mime === 'application/ogygia-remote') return { kind: 'remote-seed' };
	const src = t.attr('src');
	return {
		kind: 'script',
		label: src ? `src ${src.split('/').pop()}` : type ? `type ${type}` : 'inline'
	};
}

/** Where the element `t` opens ends: past its end tag (its raw text runs to the first `</name`),
 *  or -1 when it never closes. */
function element_end(html: string, t: FoundTag, name: string): number {
	const text = text_of(html, t, name);
	if (text === null) return -1;
	const gt = html.indexOf('>', t.end + text.length);
	return gt === -1 ? -1 : gt + 1;
}

/** Each `<name>` raw-text element (`script`, `style`) as a span, start tag through end tag. */
function raw_spans(html: string, name: string, on: (t: FoundTag, end: number) => void): void {
	for (let t = next_tag(html, name, 0); t !== null;) {
		const end = element_end(html, t, name);
		if (end === -1) return;
		on(t, end);
		t = next_tag(html, name, end);
	}
}

/** The text of the document's page seed (the first script the strip names `seed`), or null. */
export function page_seed(html: string): string | null {
	for (let t = next_tag(html, 'script', 0); t !== null;) {
		const text = text_of(html, t, 'script');
		if (text === null) return null;
		if (script_kind(t).kind === 'seed') return text;
		t = next_tag(html, 'script', t.end + text.length);
	}
	return null;
}

export function byte_strip(html: string): ByteStrip {
	const spans: StripSegment[] = [];
	raw_spans(html, 'script', (t, end) => spans.push({ ...script_kind(t), start: t.start, end }));
	raw_spans(html, 'style', (t, end) => spans.push({ kind: 'style', start: t.start, end }));
	for (let t = next_tag(html, 'link', 0); t !== null; t = next_tag(html, 'link', t.next))
		if (REL_STYLESHEET.test(t.attr('rel') ?? ''))
			spans.push({
				kind: 'css-link',
				start: t.start,
				end: t.end,
				label: t.attr('href')?.split('/').pop()
			});
	let shadow_bytes = 0;
	let shadow_count = 0;
	// (a template that is not a shadow root is passed by its start tag: one may sit inside it)
	for (let t = next_tag(html, 'template', 0); t !== null;) {
		if (t.attr('shadowrootmode') === undefined) {
			t = next_tag(html, 'template', t.next);
			continue;
		}
		const end = element_end(html, t, 'template');
		if (end === -1) break;
		shadow_bytes += end - t.start;
		shadow_count++;
		spans.push({ kind: 'shadow', start: t.start, end });
		t = next_tag(html, 'template', end);
	}
	// regions: every top-level one is a segment (an island's bytes are one block, whatever is inside)
	try {
		for (const r of scanRegions(html)) {
			if (r.depth !== 0) continue;
			const kind: StripKind =
				r.kind === 'island'
					? 'island'
					: r.kind === 'lake'
						? 'lake'
						: r.kind === 'hole'
							? 'hole'
							: 'markup';
			spans.push({
				kind,
				start: r.start,
				end: r.end,
				label: r.attrs[OG_FP] ?? r.attrs.entry ?? r.attrs.name
			});
		}
		// oxlint-disable-next-line ogygia/no-silent-failures -- a scanner that throws on a broken document leaves the strip to the regexes
	} catch {}
	spans.sort((a, b) => a.start - b.start || b.end - a.end);
	// drop spans inside an earlier one (a script inside an island is the island's bytes), fill gaps
	const head = next_tag(html, 'head', 0);
	const head_at = head === null ? 0 : Math.max(0, element_end(html, head, 'head'));
	const out: StripSegment[] = [];
	let pos = 0;
	const fill = (to: number) => {
		if (to <= pos) return;
		if (pos < head_at && to > head_at) {
			out.push({ kind: 'head', start: pos, end: head_at });
			out.push({ kind: 'markup', start: head_at, end: to });
		} else out.push({ kind: to <= head_at ? 'head' : 'markup', start: pos, end: to });
		pos = to;
	};
	for (const s of spans) {
		if (s.start < pos) continue; // nested (or overlapping) — already inside a segment
		fill(s.start);
		out.push(s);
		pos = s.end;
	}
	fill(html.length);
	const by_kind: Partial<Record<StripKind, number>> = {};
	for (const s of out) by_kind[s.kind] = (by_kind[s.kind] ?? 0) + (s.end - s.start);
	if (shadow_bytes) by_kind.shadow = shadow_bytes;
	// the elements the markup makes, the whole document's and each island's (what the browser counts)
	const lower = html.toLowerCase();
	const islands = out
		.filter((s) => s.kind === 'island' && s.label)
		.map((s) => ({ fp: s.label!, n: count_elements(lower, s.start, s.end) }));
	islands.sort((a, b) => b.n - a.n);
	const unsized = unsized_images(lower, html);
	return {
		total: html.length,
		segments: out,
		by_kind,
		shadow_bytes,
		shadow_count,
		elements: { total: count_elements(lower, 0, lower.length), islands: islands.slice(0, 3) },
		...(unsized.length ? { unsized_images: unsized } : {})
	};
}

/** Every opening tag markup makes from `start` to `end`, once: its name and where its `<` is, read
 *  by core's tag walk (comments, quoted values and a raw-text element's text hold none). A
 *  `<template>`'s contents (a declarative shadow root's too) are not in the document's own
 *  elements: the template is, nested ones inside it are not. `html` lowercased. */
function walk_tags(
	html: string,
	start: number,
	end: number,
	on_tag: (tag: string, at: number) => void
): void {
	const part = start === 0 && end === html.length ? html : html.slice(start, end);
	const at = new MarkupCursor(part);
	let templates = 0;
	while (at.next()) {
		if (at.kind !== 1 && at.kind !== 2) continue;
		// (a start tag's name follows its `<`, an end tag's its `</`)
		const name = part.slice(at.start + at.kind, at.ne);
		if (name === 'template') {
			if (at.kind === 2) templates = Math.max(0, templates - 1);
			else if (templates++ === 0) on_tag(name, start + at.start);
		} else if (at.kind === 1 && templates === 0) on_tag(name, start + at.start);
	}
}

/** The elements markup makes from `start` to `end`: each opening tag once (`walk_tags`). */
export function count_elements(html: string, start: number, end: number): number {
	let n = 0;
	walk_tags(html, start, end, () => n++);
	return n;
}

/** IMAGES THE BROWSER CANNOT HOLD ROOM FOR: each `<img>` with no `width` or no `height` attribute
 *  (and not `hidden`): until its file arrives the browser does not know its height, so the page
 *  below it moves when it does — unless CSS sizes it. Their `src`s (the first 8), in the order of the
 *  page. `lower` is the lowercased document (where the tags are), `raw` the document as sent (each
 *  `<img>` read from it, so the `src` keeps its case). */
export function unsized_images(lower: string, raw: string): string[] {
	const out: string[] = [];
	walk_tags(lower, 0, lower.length, (tag, at) => {
		if (tag !== 'img' || out.length >= 8) return;
		const img = read_tag(raw, at, at + 4);
		if (img === null) return;
		const has = (name: string) => img.attr(name) !== undefined;
		if ((has('width') && has('height')) || has('hidden')) return;
		const src = img.attr('src');
		if (src !== undefined) out.push(src.slice(0, 300));
	});
	return out;
}

/** A segment's arrival at the browser, given the document's download span from navigation timing:
 *  bytes are assumed to arrive at a steady rate between the first byte and the last. */
export function arrival_ms(
	s: { start: number; end: number },
	total: number,
	res_start: number,
	res_end: number
): { first: number; last: number } {
	if (total <= 0 || res_end <= res_start) return { first: res_start, last: res_start };
	const per = (res_end - res_start) / total;
	return { first: res_start + s.start * per, last: res_start + s.end * per };
}
