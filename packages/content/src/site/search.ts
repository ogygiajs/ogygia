import type { Heading, LinkRef } from '../index.ts';
import { href_of, OUTLINE_TOKEN, type Collection, type Outline } from './outline.ts';
import { is_dimensioned } from './dimensions.ts';
import { OgygiaError } from '../messages/runtime.ts';
import { flights, STALE } from '@ogygia/machine';
import { escapeText as esc_html } from '@ogygia/core/plugin/utils';

const FRONTMATTER_BLOCK_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const SCRIPT_BLOCK_G = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_G = /<style[\s\S]*?<\/style>/gi;
const CODE_FENCE_G = /```[\s\S]*?```/g;
const INLINE_CODE_G = /`([^`]*)`/g;
const MD_IMAGE_G = /!\[[^\]]*\]\([^)]*\)/g;
const MD_LINK_G = /\[([^\]]*)\]\([^)]*\)/g;
const HTML_TAG_G = /<[^>]+>/g;
const HEADING_HASHES_G = /^#{1,6}\s+/gm;
const MD_MARKS_G = /[*_~>]/g;
const WS_G = /\s+/g;
const WS_RE = /\s+/;
const SECTION_HEADING_RE = /^#{2,4}\s+(.+?)\s*(\{#[^}]+\})?\s*$/;

/** One searchable document — a page SECTION (split by heading), or the page lead. Mount-independent:
 *  stores `slug` + `anchor`, so href is computed per query with the caller's `base`. */
export type SearchDoc = {
	/** Stable id: `slug` or `slug#anchor`. */
	id: string;
	slug: string;
	/** Heading id to deep-link to, or empty for the page lead. */
	anchor: string;
	/** Page title. */
	title: string;
	/** Top-level nav group ("Start", "Reference"). */
	section: string;
	/** The heading this chunk sits under; empty for the page lead. */
	heading: string;
	/** Plain prose of the chunk (markdown syntax lightly stripped). */
	text: string;
};

/** One ranked hit — plain data, ready to render as a link. */
export type SearchHit = {
	href: string;
	slug: string;
	title: string;
	section: string;
	heading: string;
	/** Short excerpt of the matched chunk. */
	excerpt: string;
	score: number;
};

/** The engine adapter: build documents into a queryable index. Must run in node AND the browser. */
export type SearchEngine = {
	/** Lazy-load the engine library (optional peer). Called once before the first build. */
	init?(): Promise<void>;
	build(docs: SearchDoc[]): Promise<SearchIndex>;
};
export type SearchIndex = {
	query(q: string, opts: { limit: number; base: string }): Promise<SearchHit[]>;
};

export type SearchOptions = {
	/** Cap results (default 10). */
	limit?: number;
	/** Pre-filter: only these collections' shards are consulted (by handle identity). */
	in?: Collection[];
	/** Mount prefix for the hit hrefs (default `''`). */
	base?: string;
};

/** Light markdown/svx strip for index text: fences, tags, inline markers. Not a parser — good
 *  enough for tokenization. */
export function strip_prose(src: string): string {
	return src
		.replace(FRONTMATTER_BLOCK_RE, '')
		.replace(SCRIPT_BLOCK_G, '')
		.replace(STYLE_BLOCK_G, '')
		.replace(CODE_FENCE_G, ' ')
		.replace(INLINE_CODE_G, '$1')
		.replace(MD_IMAGE_G, ' ')
		.replace(MD_LINK_G, '$1')
		.replace(HTML_TAG_G, ' ')
		.replace(HEADING_HASHES_G, '')
		.replace(MD_MARKS_G, ' ')
		.replace(WS_G, ' ')
		.trim();
}

/** Split a page's source into `{ heading, text }` chunks aligned to its collected headings. */
export function split_sections(
	source: string,
	headings: Heading[]
): { heading: Heading | null; text: string }[] {
	const body = source.replace(FRONTMATTER_BLOCK_RE, '');
	const lines = body.split('\n');
	const chunks: { heading: Heading | null; text: string }[] = [];
	let current: { heading: Heading | null; lines: string[] } = { heading: null, lines: [] };
	let next_heading = 0;

	const heading_text = (line: string): string | null => {
		const m = line.match(SECTION_HEADING_RE);
		return m ? m[1].trim() : null;
	};

	for (const line of lines) {
		const ht = heading_text(line);
		if (ht !== null) {
			chunks.push({ heading: current.heading, text: current.lines.join('\n') });
			const collected = headings[next_heading];
			current = { heading: collected ?? null, lines: [] };
			next_heading += 1;
		} else {
			current.lines.push(line);
		}
	}
	chunks.push({ heading: current.heading, text: current.lines.join('\n') });
	return chunks
		.map((c) => ({ heading: c.heading, text: strip_prose(c.text) }))
		.filter((c) => c.text || c.heading);
}

/**
 * Build every searchable document for the outline's leaves (optionally scoped to collections): one
 * per section, keyed `slug#anchor` (the bare slug for the heading-less part, all of it in one
 * document), or one per data-only entry from its display fields. A dimensioned site indexes its
 * default coordinate only, so a fallback page is never a second hit.
 */
export async function build_docs(ol: Outline, only?: Collection[]): Promise<SearchDoc[]> {
	const docs: SearchDoc[] = [];
	const addrs = is_dimensioned(ol) ? await ol.canonicalAddresses() : await ol.addresses();
	for (const slug of addrs) {
		const hit = await ol.resolve(slug);
		if (!hit) continue;
		if (only && !only.includes(hit.collection)) continue;
		const entry = await hit.collection.get(hit.record.entryId);
		if (!entry) continue;
		const data = entry.data as { title?: string; summary?: string };
		const title = typeof data.title === 'string' ? data.title : slug;
		const headings = extract_headings(entry.meta);

		if (entry.source) {
			const chunks = split_sections(await entry.source(), headings);
			const by_key = new Map<string, SearchDoc>();
			for (const c of chunks) {
				const anchor = c.heading?.id ?? '';
				const id = anchor ? `${slug}#${anchor}` : slug;
				const existing = by_key.get(id);
				if (existing) {
					existing.text = `${existing.text} ${c.text}`.trim();
					continue;
				}
				const doc: SearchDoc = {
					id,
					slug,
					anchor,
					title,
					section: hit.record.section,
					heading: c.heading?.text ?? '',
					text: c.text
				};
				by_key.set(id, doc);
				docs.push(doc);
			}
		} else {
			const summary = typeof data.summary === 'string' ? data.summary : '';
			const extra = Object.values(entry.data)
				.filter((v): v is string => typeof v === 'string')
				.join(' ');
			docs.push({
				id: slug,
				slug,
				anchor: '',
				title,
				section: hit.record.section,
				heading: '',
				text: strip_prose(`${summary} ${extra}`)
			});
		}
	}
	return docs;
}

function extract_headings(meta: unknown): Heading[] {
	if (meta && typeof meta === 'object' && 'headings' in meta) {
		const h = (meta as { headings: unknown }).headings;
		if (Array.isArray(h)) return h as Heading[];
	}
	return [];
}

type OramaModule = typeof import('@orama/orama');

async function load_orama(): Promise<OramaModule> {
	try {
		return await import('@orama/orama');
	} catch {
		throw new OgygiaError('content_search_engine_missing');
	}
}

const ESC_RX = /[.*+?^${}()|[\]\\]/g;

/**
 * A match-centered excerpt with the query terms wrapped in `<mark>` — the window starts just before
 * the FIRST term occurrence (not the chunk start). Output is HTML-escaped first, so the consumer
 * renders it with `{@html}` safely; `<mark>` is the only markup.
 */
export function excerpt_of(text: string, terms: string[], span = 150): string {
	const lower = text.toLowerCase();
	let at = -1;
	for (const t of terms) {
		const i = lower.indexOf(t);
		if (i > -1 && (at === -1 || i < at)) at = i;
	}
	const start = at <= 40 ? 0 : at - 40;
	const window = text.slice(start, start + span);
	// One pass over the raw text (longest term first), escaping each piece as it is written: a term
	// never matches inside a mark or an entity. test/property-search-excerpt.test.ts.
	const any = terms
		.filter(Boolean)
		.sort((a, b) => b.length - a.length)
		.map((t) => t.replace(ESC_RX, '\\$&'))
		.join('|');
	let out = '';
	let from = 0;
	if (any)
		for (const m of window.matchAll(new RegExp(any, 'gi'))) {
			out = `${out}${esc_html(window.slice(from, m.index))}<mark>${esc_html(m[0])}</mark>`;
			from = m.index + m[0].length;
		}
	out += esc_html(window.slice(from));
	return (start > 0 ? '…' : '') + out + (start + span < text.length ? '…' : '');
}

/** Title-match re-rank: a hit whose TITLE carries the query outranks body matches, and the page
 *  itself outranks its sections (searching "snippet" puts the `{#snippet …}` page first). */
export function rerank(hits: SearchHit[], query: string): SearchHit[] {
	const q = query.toLowerCase();
	const terms = q.split(WS_RE).filter(Boolean);
	const scored = hits.map((h) => {
		const title = h.title.toLowerCase();
		const heading = (h.heading ?? '').toLowerCase();
		let m = 1;
		if (title.includes(q)) m *= 4;
		else if (terms.every((t) => title.includes(t))) m *= 2;
		if (heading && terms.every((t) => heading.includes(t))) m *= 1.5;
		if (!h.href.includes('#') && title.includes(q)) m *= 1.5;
		return { ...h, score: h.score * m };
	});
	return scored.sort((a, b) => b.score - a.score);
}

/**
 * The default engine: Orama (an optional peer, loaded on first use) over the section documents,
 * title and heading boosted, then `rerank`ed. It fetches three times the limit, so `rerank` can lift
 * a page whose title is the query above a section the engine scored higher. Each document goes in
 * under its row, so two that share an id are both indexed.
 */
export function orama_engine(): SearchEngine {
	let mod: OramaModule | null = null;
	return {
		async init() {
			mod ??= await load_orama();
		},
		async build(docs) {
			mod ??= await load_orama();
			const db = mod.create({
				schema: { title: 'string', heading: 'string', text: 'string', section: 'string' }
			});
			const by_id = new Map<string, SearchDoc>();
			docs.forEach((d, i) => {
				const rid = String(i);
				by_id.set(rid, d);
				mod!.insert(db, {
					id: rid,
					title: d.title,
					heading: d.heading,
					text: d.text,
					section: d.section
				});
			});
			return {
				async query(q, { limit, base }) {
					const res = await mod!.search(db, {
						term: q,
						limit: limit * 3,
						boost: { title: 3, heading: 2, text: 1 },
						tolerance: 1
					});
					const terms = q.toLowerCase().split(WS_RE).filter(Boolean);
					const hits: SearchHit[] = [];
					for (const h of res.hits) {
						const doc = by_id.get(String(h.id));
						if (!doc) continue;
						hits.push({
							href: href_of(base, doc.slug) + (doc.anchor ? `#${doc.anchor}` : ''),
							slug: doc.slug,
							title: doc.title,
							section: doc.section,
							heading: doc.heading,
							excerpt: excerpt_of(doc.text, terms),
							score: h.score
						});
					}
					return rerank(hits, q).slice(0, limit);
				}
			};
		}
	};
}

export type SearchBrain = (q: string, opts?: SearchOptions) => Promise<SearchHit[]>;

/**
 * Create `site.search`. The index builds on first query (single-flight), from ALL leaves (or the
 * scoped subset: each distinct scope gets its own index; `base` applies at query time). It is built
 * from one materialization of the outline, so a new one (the content changed) builds it again, and
 * a failed build is never kept. The same documents serialize to `search.json` (`site.emit.search`).
 */
export function create_search(ol: Outline, engine: SearchEngine): SearchBrain {
	const indexes = flights.keyed<{
		scope_id: string;
		from: unknown;
		in: Collection[] | undefined;
	}>()({
		name: 'content search index',
		key: ['scope_id'],
		ignore: {
			in: 'the collections scope_id spells',
			from: 'the materialization it was built from: the answer carries it, and one built from an older one is built again'
		},
		run: async (i) => {
			await engine.init?.();
			return { index: await engine.build(await build_docs(ol, i.in)), from: i.from };
		}
	});
	const token = (ol as { [OUTLINE_TOKEN]?: () => unknown })[OUTLINE_TOKEN];

	const search: SearchBrain = async (q, opts = {}) => {
		const query = q.trim();
		if (!query) return [];
		const limit = opts.limit ?? 10;
		const base = opts.base ?? '';
		const scope_id = opts.in ? opts.in.map((c) => scope_tag(c)).join(',') : '*';
		const from = token ? await token.call(ol) : null;
		const input = { scope_id, from, in: opts.in };
		const kept = indexes.peek({ scope_id });
		let built = await indexes.get(input, {
			fresh: kept?.kind === 'kept' && kept.answer.from !== from
		});
		if (built !== STALE && built.from !== from) built = await indexes.get(input, { fresh: true });
		// (a newer query's build took its place meanwhile: that one answers)
		if (built === STALE) return search(q, opts);
		return built.index.query(query, { limit, base });
	};
	return search;
}

const scope_tags = new WeakMap<object, number>();
let scope_seq = 0;
function scope_tag(c: Collection): number {
	let t = scope_tags.get(c);
	if (t === undefined) {
		t = ++scope_seq;
		scope_tags.set(c, t);
	}
	return t;
}

export type { LinkRef };
