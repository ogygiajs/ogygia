import type { RegionValue } from '@ogygia/core';

/** A heading pulled from the markdown pass (h2–h4). Powers on-page TOCs; rides `markdown` `meta`. */
export type Heading = { depth: 2 | 3 | 4; id: string; text: string };

/** One markdown link collected during the compile pass (raw, unclassified). Rides `markdown` `meta`;
 *  ogygia's audit resolves these against the site's address space. `line` is approximate (relative
 *  to the post-frontmatter text). */
export type LinkRef = { href: string; text: string; line?: number };

/**
 * A resolved relation target: a shallow reference to another entry — its `id` and validated `data`.
 * Deliberately shallow (no body, no URL); build the link from `ref.id`, or `collection.get(ref.id)`.
 */
export type RefEntry<Data = Record<string, unknown>> = {
	id: string;
	data: Data;
};

/**
 * Declared relations: `{ name: collection }`, or `{ get name() { return collection } }` for a cycle.
 * The frontmatter field named after each relation carries the target id(s): a string → one ref, a
 * string[] → many.
 */
export type ContentRelations = Record<string, unknown>;

/**
 * A content REF — the shallow face of an entry, what `refs()` yields and the catalog holds: identity
 * + validated `data` (+ source-derived `meta`, structural `order`, `filePath`, and graph fields). NO
 * body, NO source text — those are heavy faces that live only on {@link Entry}, fetched by `get()`.
 * "Refs are what a corpus admits to having; an entry is what one page pays for."
 */
export type ContentRef<Data = Record<string, unknown>, Meta = Record<string, never>> = {
	id: string;
	/** Validated frontmatter. */
	data: Data;
	/** Source-derived facts (headings, reading time, …). `{}` for a source that derives none. */
	meta: Meta;
	/** Per-level sibling order, when the source supplies it (`folder()` from `NN-`, a CMS from a field). */
	order?: number[];
	/** Glob key / file path when the source has one. */
	filePath?: string;
	/** Resolved relations (populated by the graph pass on read paths that resolve them). */
	rel?: Record<string, RefEntry | RefEntry[] | null>;
	/** Entries pointing at this one (populated by the graph pass). */
	backlinks?: RefEntry[];
};

/**
 * A resolved entry from `get()` — `data`, `meta`, `body`, and the graph fields fully populated. `rel`
 * is `{}` and `backlinks` `[]` when the collection has no graph. `body` is an inline `<Region>`,
 * rendered in the page's own SSR pass, so islands inside it hydrate normally.
 */
export type Entry<Data = Record<string, unknown>, Meta = Record<string, never>> = {
	id: string;
	data: Data;
	meta: Meta;
	body?: RegionValue;
	/** Lazy raw SOURCE text, when the source provides it (`markdown()` does). Server-only; never wired. */
	source?: () => Promise<string>;
	rel: Record<string, RefEntry | RefEntry[] | null>;
	backlinks: RefEntry[];
};

type StandardResult =
	| { value: unknown; issues?: undefined }
	| { issues: ReadonlyArray<{ readonly message?: string }> };

/** Any Standard Schema (valibot / zod / arktype) or a `{ parse }` object. */
export type SchemaLike = {
	['~standard']?: {
		validate: (value: unknown) => StandardResult | Promise<StandardResult>;
	};
	parse?: (value: unknown) => unknown;
};

export { glob, defineSource, toRawSource, mapRaw, enrich } from './source.ts';
export type {
	Source,
	SourceRef,
	SourceEntry,
	EntryParts,
	RawSource,
	RawRecord,
	Format,
	GlobMap,
	GroupMeta,
	SourceChanges
} from './source.ts';

export { markdown, json } from './formats.ts';
export type { MarkdownMeta } from './formats.ts';
export { folder } from './folder.ts';
export type { FolderOptions } from './folder.ts';

export {
	numbered,
	dated,
	date_of as dateOf,
	title_case as titleCase,
	strip_order_prefix as stripOrderPrefix,
	order_of as orderOf
} from './convention.ts';
export type { Convention, NumberedOptions, MetaDecoration } from './convention.ts';
export { blocks } from './blocks.ts';
export type {
	BlockNode,
	BlockRegistry,
	BlockSource,
	ResolvedBlockNode,
	BlockSchedule
} from './blocks.ts';

export { content } from './factory.ts';
export type { ContentHandle, ContentOptions } from './factory.ts';

export { parseSchema } from './schema.ts';

export type { ContentMode, GetRemote, ListRemote, WithRemotes } from './server.ts';

export * from './site/index.ts';
