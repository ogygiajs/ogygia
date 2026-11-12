import type { ContentEntry, ContentHandle, Entry } from '../index.ts';
import type { Crumb, NavItem, NavLeaf, NavRef, NavTree, Resolved } from './types.ts';
import { title_case } from '../convention.ts';
import type { GroupMeta } from '../index.ts';
import { catalog_fresh, catalog_loaded, catalog_version } from '../collection-base.ts';
import { OgygiaError } from '../messages/runtime.ts';
import { flights, STALE } from '@ogygia/machine';

/**
 * The materialization an outline answers from for a context (an opaque token: a new one each time
 * the outline is woven again). The site's search keys its index on it, so the index follows the
 * content (#193). Internal: read by symbol, not part of the outline's API.
 */
export const OUTLINE_TOKEN: unique symbol = Symbol.for('ogygia.content.outline-token');

/** A content collection, as the outline consumes it (the browser-safe `content()` handle). */
export type Collection = ContentHandle<Record<string, unknown>, unknown>;

type Ent = ContentEntry<Record<string, unknown>, unknown>;

const SELECTION: unique symbol = Symbol.for('ogygia.pharos.selection');

/** A subset of one collection, in resolution order — produced by `pick()`. */
export type Selection = {
	readonly [SELECTION]: true;
	readonly collection: Collection;
	readonly patterns: string[];
};

/** A plain link node — points anywhere; not backed by an entry. */
export type LinkSpec = { label: string; href: string };

/** What can sit inside a group's `items`, or at the top level of a spec. */
export type OutlineNode = Collection | Selection | GroupSpec | LinkSpec | OutlineThunk;
export type OutlineThunk = () => OutlineNode[] | OutlineNode | Promise<OutlineNode[] | OutlineNode>;

/** An explicit group. `base` prefixes the slugs of entries beneath it. */
export type GroupSpec = {
	label: string;
	items: Collection | Selection | OutlineNode[] | OutlineThunk;
	/** Slug prefix for every entry placed under this group (disambiguates collections). */
	base?: string;
	/**
	 * ADDRESS POLICY for entries under this group: map an entry id to its slug (BEFORE `base` is
	 * prefixed). The address the reader sees can diverge from the id/nav structure — e.g. drop the
	 * section segment so `runes/$state` addresses as `$state` while nav keeps the `runes` grouping.
	 * Slug collisions are the same named build error as any other. Default: the id, unchanged.
	 */
	slug?: (id: string) => string;
	collapsed?: boolean;
	badge?: string;
};

/** A whole spec: a bare collection (degenerate case) or an ordered list of nodes. */
export type OutlineSpec = Collection | OutlineNode[];
export type OutlineOptions = {
	/**
	 * Old addresses an entry declares for itself (redirect history). By CONVENTION reads the entry's
	 * `data.redirect_from` (string or string[] — remember to include the field in your schema, or
	 * validation strips it). Override to read a different field or source.
	 */
	redirects?: (entry: Ent) => string[] | string | undefined;
};

/** `pick(collection, ...patterns)` — a subset in pattern order (exact ids or `*`/`**` globs). */
export function pick(collection: Collection, ...patterns: string[]): Selection {
	return { [SELECTION]: true, collection, patterns };
}

function is_collection(x: unknown): x is Collection {
	return (
		!!x &&
		typeof x === 'object' &&
		typeof (x as Collection).refs === 'function' &&
		typeof (x as Collection).get === 'function'
	);
}
function is_selection(x: unknown): x is Selection {
	return !!x && typeof x === 'object' && (x as Record<symbol, unknown>)[SELECTION] === true;
}
function is_thunk(x: unknown): x is OutlineThunk {
	return typeof x === 'function';
}
function is_group(x: unknown): x is GroupSpec {
	return (
		!!x &&
		typeof x === 'object' &&
		'items' in (x as GroupSpec) &&
		typeof (x as GroupSpec).label === 'string'
	);
}
function is_link(x: unknown): x is LinkSpec {
	return (
		!!x &&
		typeof x === 'object' &&
		'href' in (x as LinkSpec) &&
		!('items' in (x as Record<string, unknown>))
	);
}

function str(v: unknown): string | undefined {
	return typeof v === 'string' && v ? v : undefined;
}

function join_slug(base: string, slug: string): string {
	return [base, slug]
		.filter(Boolean)
		.join('/')
		.replace(/\/{2,}/g, '/');
}

/** Compose the mount `base` and a slug into an href. Links bypass this. */
export function href_of(base: string, slug: string): string {
	const b = (base || '').replace(/\/+$/, '');
	return `${b}/${slug}`.replace(/([^:])\/{2,}/g, '$1/');
}

function is_glob(pattern: string): boolean {
	return pattern.includes('*');
}
function glob_to_regexp(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, '\0')
		.replace(/\*/g, '[^/]*')
		.replace(/\0/g, '.*');
	return new RegExp(`^${escaped}$`);
}

type LeafRecord = Resolved & { title: string; summary?: string; collection: Collection };

type Materialized = {
	tree: NavTree;
	order: string[];
	by_slug: Map<string, LeafRecord>;
	slug_of: Map<number, Map<string, string>>;
	aliases: Map<string, string>;
	collections: Collection[];
	read: Map<Collection, number | null>;
};

type BuildCtx = {
	base: string;
	crumbs: Crumb[];
	section: string | undefined;
	clean_path: string;
	slug?: (id: string) => string;
};

/**
 * A request context threaded into every read — the second axis (beside a `dimensions()` coordinate)
 * that the outline keys its materialization by. Flat + bounded (`{ preview: true }`, `{ plan: 'pro' }`),
 * never a user id: each distinct context mints one memoized tree. `{}` is the public projection.
 */
export type ReadContext = Record<string, unknown>;

/** Reading-order policy for prev/next: the whole site, or bounded by the top-level section. */
export type TrailScope = 'site' | 'group';

/** Stable memo key for a context — sorted keys so `{a,b}` and `{b,a}` share one materialization. */
export function ctx_key(ctx: ReadContext | undefined): string {
	if (!ctx) return '';
	const keys = Object.keys(ctx).sort();
	if (keys.length === 0) return '';
	return JSON.stringify(keys.map((k) => [k, ctx[k]]));
}

/** The public Outline — collection-like over arrangement. Mostly consumed through `pharos()`. */
export interface Outline {
	/** The full nav tree, hrefs resolved for `base` (default `''`), in read context `ctx` (default public). */
	tree(base?: string, ctx?: ReadContext): Promise<NavTree>;
	/** Resolve a slug to its collection + entry + placement, or `null`. */
	resolve(
		slug: string,
		ctx?: ReadContext
	): Promise<{ record: Resolved; collection: Collection } | null>;
	/** Every leaf slug, in reading order — the prerender source (public projection by default). */
	addresses(ctx?: ReadContext): Promise<string[]>;
	/** Reading-order neighbors of a slug, as refs for `base` (default `''`). `scope: 'group'` bounds
	 *  prev/next to the top-level section. */
	neighbors(
		slug: string,
		base?: string,
		ctx?: ReadContext,
		scope?: TrailScope
	): Promise<{ prev?: NavRef; next?: NavRef }>;
	/** Map an entry id (within a collection) to its slug — for resolving graph relations. */
	slug_for(collection: Collection, entryId: string, ctx?: ReadContext): Promise<string | undefined>;
	/** Canonical slug for a declared old address (redirect history), or `undefined`. */
	alias(slug: string, ctx?: ReadContext): Promise<string | undefined>;
	/** The whole redirect map: old slug → canonical slug. */
	aliases(ctx?: ReadContext): Promise<Map<string, string>>;
}

function unchanged(read: Map<Collection, number | null>): boolean {
	for (const [c, v] of read) if (!catalog_fresh(c, v)) return false;
	return true;
}

function versions_now(read: Map<Collection, number | null>): Map<Collection, number | null> {
	const now = new Map<Collection, number | null>();
	for (const c of read.keys()) now.set(c, catalog_version(c));
	return now;
}

class OutlineImpl implements Outline {
	readonly #spec: OutlineSpec;
	readonly #opts: OutlineOptions;
	readonly #weaves = flights.keyed<{ key: string; ctx: ReadContext }>()({
		name: 'content outline weaves',
		key: ['key'],
		ignore: { ctx: 'the key spells all of it (ctx_key: every field, sorted)' },
		run: ({ key, ctx }) => this.#weave(key, ctx)
	});
	readonly #failed = new Map<string, Map<Collection, number | null>>();

	constructor(spec: OutlineSpec, opts: OutlineOptions = {}) {
		this.#spec = spec;
		this.#opts = opts;
	}

	async #ready(ctx: ReadContext = {}): Promise<Materialized> {
		const key = ctx_key(ctx);
		const seen = this.#weaves.peek({ key });
		const failed = this.#failed.get(key);
		const fresh =
			seen?.kind === 'kept' &&
			!seen.flying &&
			!unchanged(seen.answer.read) &&
			!(failed !== undefined && unchanged(failed));
		const m = await this.#weaves.get({ key, ctx }, { fresh });
		return m === STALE ? this.#ready(ctx) : m;
	}

	async #weave(key: string, ctx: ReadContext): Promise<Materialized> {
		const seen = this.#weaves.peek({ key });
		const good = seen?.kind === 'kept' ? seen.answer : null;
		const at = good ? versions_now(good.read) : null;
		try {
			const m = await materialize(this.#spec, this.#opts, ctx);
			this.#failed.delete(key);
			return m;
		} catch (error) {
			if (!good || !at) throw error;
			this.#failed.set(key, at);
			console.error(new OgygiaError('content_outline_weave_failed'), error);
			return good;
		}
	}

	[OUTLINE_TOKEN](ctx: ReadContext = {}): Promise<Materialized> {
		return this.#ready(ctx);
	}

	async tree(base = '', ctx: ReadContext = {}) {
		return with_base((await this.#ready(ctx)).tree, base);
	}

	async resolve(slug: string, ctx: ReadContext = {}) {
		const m = await this.#ready(ctx);
		const record = m.by_slug.get(normalize_slug(slug));
		if (!record) return null;
		return { record, collection: record.collection };
	}

	async addresses(ctx: ReadContext = {}) {
		return (await this.#ready(ctx)).order.slice();
	}

	async neighbors(slug: string, base = '', ctx: ReadContext = {}, scope: TrailScope = 'site') {
		const m = await this.#ready(ctx);
		const i = m.order.indexOf(normalize_slug(slug));
		if (i < 0) return {};
		const here = m.by_slug.get(m.order[i])?.section;
		const ref = (s: string | undefined): NavRef | undefined => {
			if (!s) return undefined;
			const r = m.by_slug.get(s);
			if (!r) return undefined;
			if (scope === 'group' && r.section !== here) return undefined;
			return to_ref(r, base);
		};
		return { prev: ref(m.order[i - 1]), next: ref(m.order[i + 1]) };
	}

	async slug_for(collection: Collection, entryId: string, ctx: ReadContext = {}) {
		const m = await this.#ready(ctx);
		const idx = m.collections.indexOf(collection);
		return idx < 0 ? undefined : m.slug_of.get(idx)?.get(entryId);
	}

	async alias(slug: string, ctx: ReadContext = {}) {
		return (await this.#ready(ctx)).aliases.get(normalize_slug(slug));
	}

	async aliases(ctx: ReadContext = {}) {
		return new Map((await this.#ready(ctx)).aliases);
	}
}

/**
 * Weave any number of collections + an arrangement into one derived `Outline`: ONE normalized tree
 * (`NavTree`) plus an address map. Everything downstream (nav, prev/next, section labels,
 * prerender entries) is a view of it. It answers "how the corpora read" the way `content()`
 * answers "what exists".
 *
 * Spec grammar (every form composes with every other):
 *   - a bare collection            → the remainder of it, convention-expanded (NN- order, id-path groups)
 *   - `pick(coll, ...patterns)`    → a flat, ordered selection (exact ids and `*`/`**` globs)
 *   - `{ label, items, ... }`      → an explicit group holding a collection / selection / nested items
 *   - `{ label, href }`            → a plain link, its href kept under any mount base
 *   - `() => items`                → a computed subtree (escape hatch)
 *
 * Each entry is placed once: a later item skips what an earlier one placed, and a bare collection
 * takes the not-yet-placed remainder. Unknown pick ids, empty glob matches, slug collisions,
 * unplaced ("orphan") entries and clashing `redirect_from` addresses are build errors, named.
 *
 * Each read context weaves once; readers at once share the weave, and later readers keep it until
 * a collection it read changes. A weave that fails over changed content keeps the last good one
 * and says why; a first weave that fails is the caller's error.
 */
export function outline(spec: OutlineSpec, opts: OutlineOptions = {}): Outline {
	return new OutlineImpl(spec, opts);
}

function normalize_slug(slug: string): string {
	return slug.replace(/^\/+|\/+$/g, '');
}
function to_ref(r: LeafRecord, base: string): NavRef {
	return {
		slug: r.slug,
		href: href_of(base, r.slug),
		title: r.title,
		...(r.summary ? { summary: r.summary } : {})
	};
}

function with_base(tree: NavTree, base: string): NavTree {
	return tree.map((item): NavItem => {
		if (item.kind === 'group') return { ...item, items: with_base(item.items, base) };
		if (item.kind === 'link') return item;
		return { ...item, href: href_of(base, item.slug) };
	});
}

async function materialize(
	spec: OutlineSpec,
	opts: OutlineOptions,
	ctx: ReadContext = {}
): Promise<Materialized> {
	const collections: Collection[] = [];
	const slug_of = new Map<number, Map<string, string>>();
	const placed = new Map<Collection, Set<string>>();
	const entries_cache = new Map<Collection, Ent[]>();
	const groups_cache = flights({
		name: 'content outline groups',
		run: async (c: Collection): Promise<Map<string, GroupMeta>> => (await c.groups?.()) ?? new Map()
	});
	const read = new Map<Collection, number | null>();
	const by_slug = new Map<string, LeafRecord>();
	const order: string[] = [];
	const errors: string[] = [];
	const segs_of = (e: Ent): { key: string; order: number }[] => {
		const parts = e.id.split('/').filter(Boolean);
		return parts.map((key, i) => ({ key, order: e.order?.[i] ?? Number.MAX_SAFE_INTEGER }));
	};
	const order_key = (e: Ent): number[] => segs_of(e).map((s) => s.order);
	const compare_order = (a: Ent, b: Ent): number => {
		const ka = order_key(a);
		const kb = order_key(b);
		for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
			const d = (ka[i] ?? Number.MAX_SAFE_INTEGER) - (kb[i] ?? Number.MAX_SAFE_INTEGER);
			if (d) return d;
		}
		return a.id.localeCompare(b.id);
	};
	const alias_claims: { alias: string; canonical: string }[] = [];
	const read_redirects =
		opts.redirects ?? ((e: Ent) => e.data.redirect_from as string[] | string | undefined);

	const index_of = (c: Collection): number => {
		let i = collections.indexOf(c);
		if (i < 0) {
			i = collections.push(c) - 1;
			slug_of.set(i, new Map());
			placed.set(c, new Set());
		}
		return i;
	};
	const entries_of = async (c: Collection): Promise<Ent[]> => {
		let e = entries_cache.get(c);
		if (!e) {
			// @why stamped before the read, an edit landing during it is newer, so the next read weaves again (test: test/lifecycle.test.ts › a change that lands while its entries are graphed: the next read weaves again)
			const at = await catalog_loaded(c);
			e = await c.refs(ctx);
			read.set(c, at);
			entries_cache.set(c, e);
		}
		return e;
	};
	const groups_of = (c: Collection): Promise<Map<string, GroupMeta>> =>
		groups_cache.get(c).then((m) => (m === STALE ? new Map<string, GroupMeta>() : m));

	const register_leaf = (
		entry: Ent,
		col_index: number,
		collection: Collection,
		ctx: BuildCtx
	): NavLeaf => {
		const addr = ctx.slug ? ctx.slug(entry.id) : entry.id;
		const slug = join_slug(ctx.base, addr);
		const title = str(entry.data.title) ?? entry.id;
		const summary = str(entry.data.summary);
		const badge = str(entry.data.badge);
		if (by_slug.has(slug)) {
			const prev = by_slug.get(slug)!;
			errors.push(
				`slug collision '${slug}' — from collection #${prev.collectionIndex}:${prev.entryId} and #${col_index}:${entry.id}; add a group \`base\` to disambiguate`
			);
		} else {
			by_slug.set(slug, {
				slug,
				entryId: entry.id,
				collectionIndex: col_index,
				section: ctx.section ?? '',
				crumbs: ctx.crumbs,
				...(entry.filePath ? { filePath: entry.filePath } : {}),
				title,
				...(summary ? { summary } : {}),
				collection
			});
			slug_of.get(col_index)!.set(entry.id, slug);
			order.push(slug);
			const declared = read_redirects(entry);
			for (const old of typeof declared === 'string'
				? [declared]
				: Array.isArray(declared)
					? declared
					: []) {
				if (typeof old === 'string' && old)
					alias_claims.push({ alias: join_slug(ctx.base, normalize_slug(old)), canonical: slug });
			}
		}
		placed.get(collection)!.add(entry.id);
		return {
			kind: 'leaf',
			slug,
			href: '',
			title,
			...(summary ? { summary } : {}),
			...(badge ? { badge } : {})
		};
	};

	const expand_grouped = async (
		list: Ent[],
		col_index: number,
		collection: Collection,
		ctx: BuildCtx,
		depth: number,
		group_map: Map<string, GroupMeta>
	): Promise<NavItem[]> => {
		type Bucket = { key: string; order: number; leaf?: Ent; children: Ent[] };
		const buckets = new Map<string, Bucket>();
		for (const e of list) {
			const segs = segs_of(e);
			const at = segs[depth];
			if (!at) continue;
			const b = buckets.get(at.key) ?? { key: at.key, order: at.order, children: [] };
			if (segs.length === depth + 1) b.leaf = e;
			else b.children.push(e);
			b.order = Math.min(b.order, at.order);
			buckets.set(at.key, b);
		}
		const sorted = [...buckets.values()].sort(
			(a, b) => a.order - b.order || a.key.localeCompare(b.key)
		);
		const items: NavItem[] = [];
		for (const b of sorted) {
			if (b.leaf && b.children.length === 0) {
				items.push(register_leaf(b.leaf, col_index, collection, ctx));
				continue;
			}
			const child_clean = ctx.clean_path ? `${ctx.clean_path}/${b.key}` : b.key;
			const label = group_map.get(child_clean)?.label ?? title_case(b.key);
			const child_ctx: BuildCtx = {
				base: ctx.base,
				crumbs: [...ctx.crumbs, { label }],
				section: ctx.section ?? label,
				clean_path: child_clean,
				slug: ctx.slug
			};
			const child_items: NavItem[] = [];
			if (b.leaf) child_items.push(register_leaf(b.leaf, col_index, collection, child_ctx));
			child_items.push(
				...(await expand_grouped(
					b.children,
					col_index,
					collection,
					child_ctx,
					depth + 1,
					group_map
				))
			);
			items.push({ kind: 'group', label, items: child_items });
		}
		return items;
	};

	const expand_selection = async (sel: Selection, ctx: BuildCtx): Promise<NavItem[]> => {
		const col_index = index_of(sel.collection);
		const all = await entries_of(sel.collection);
		const by_id = new Map(all.map((e) => [e.id, e]));
		const chosen: Ent[] = [];
		const seen = new Set<string>();
		for (const pat of sel.patterns) {
			if (is_glob(pat)) {
				const rx = glob_to_regexp(pat);
				const matched = all.filter((e) => rx.test(e.id)).sort(compare_order);
				if (matched.length === 0)
					errors.push(`pick pattern '${pat}' matched nothing in collection #${col_index}`);
				for (const m of matched) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					chosen.push(m);
				}
			} else {
				const e = by_id.get(pat);
				if (!e) errors.push(`pick id '${pat}' not found in collection #${col_index}`);
				else if (!seen.has(e.id)) {
					seen.add(e.id);
					chosen.push(e);
				}
			}
		}
		const items: NavItem[] = [];
		for (const e of chosen) {
			if (placed.get(sel.collection)!.has(e.id)) continue;
			items.push(register_leaf(e, col_index, sel.collection, ctx));
		}
		return items;
	};

	const expand_collection = async (collection: Collection, ctx: BuildCtx): Promise<NavItem[]> => {
		const col_index = index_of(collection);
		const [all, group_map] = await Promise.all([entries_of(collection), groups_of(collection)]);
		const remainder = all.filter((e) => !placed.get(collection)!.has(e.id));
		return expand_grouped(
			remainder,
			col_index,
			collection,
			{ ...ctx, clean_path: '' },
			0,
			group_map
		);
	};

	const build_group = async (group: GroupSpec, ctx: BuildCtx): Promise<NavItem> => {
		const child_ctx: BuildCtx = {
			base: join_slug(ctx.base, group.base ?? ''),
			crumbs: [...ctx.crumbs, { label: group.label }],
			section: ctx.section ?? group.label,
			clean_path: '',
			slug: group.slug ?? ctx.slug
		};
		const items = await build_items(as_nodes(group.items), child_ctx);
		return {
			kind: 'group',
			label: group.label,
			...(group.collapsed !== undefined ? { collapsed: group.collapsed } : {}),
			...(group.badge ? { badge: group.badge } : {}),
			items
		};
	};

	async function build_items(nodes: OutlineNode[], ctx: BuildCtx): Promise<NavItem[]> {
		const out: NavItem[] = [];
		for (const node of nodes) {
			if (is_thunk(node)) {
				const r = await node();
				out.push(...(await build_items(Array.isArray(r) ? r : [r], ctx)));
			} else if (is_selection(node)) {
				out.push(...(await expand_selection(node, ctx)));
			} else if (is_collection(node)) {
				out.push(...(await expand_collection(node, ctx)));
			} else if (is_group(node)) {
				out.push(await build_group(node, ctx));
			} else if (is_link(node)) {
				out.push({ kind: 'link', label: node.label, href: node.href });
			} else {
				errors.push(`unrecognized outline node: ${describe(node)}`);
			}
		}
		return out;
	}

	const root_ctx: BuildCtx = { base: '', crumbs: [], section: undefined, clean_path: '' };
	const tree = await build_items(is_collection(spec) ? [spec] : spec, root_ctx);

	for (let i = 0; i < collections.length; i++) {
		const c = collections[i];
		const ids = (await entries_of(c)).map((e) => e.id);
		const set = placed.get(c)!;
		const orphans = ids.filter((id) => !set.has(id));
		if (orphans.length)
			errors.push(
				`collection #${i} has ${orphans.length} unplaced entr${orphans.length === 1 ? 'y' : 'ies'}: ${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? ', …' : ''} — cover with a bare-collection remainder, a pick, or remove them`
			);
	}

	const aliases = new Map<string, string>();
	for (const { alias, canonical } of alias_claims) {
		if (by_slug.has(alias))
			errors.push(
				`redirect_from '${alias}' (on ${canonical}) shadows a live page — remove the alias or the page`
			);
		else if (aliases.has(alias) && aliases.get(alias) !== canonical)
			errors.push(
				`redirect_from '${alias}' claimed by both ${aliases.get(alias)} and ${canonical}`
			);
		else aliases.set(alias, canonical);
	}

	if (errors.length)
		throw new Error(`[ogygia/pharos] outline could not be built:\n  - ${errors.join('\n  - ')}`);

	return { tree, order, by_slug, slug_of, aliases, collections, read };
}

function as_nodes(items: GroupSpec['items']): OutlineNode[] {
	if (Array.isArray(items)) return items;
	return [items];
}

function describe(node: unknown): string {
	if (node && typeof node === 'object') return `object with keys [${Object.keys(node).join(', ')}]`;
	return typeof node;
}

/** Resolve a raw entry (for `site.doc`) — exposed so `pharos` can pull the body without re-resolving. */
export type ResolvedEntry<
	Data extends Record<string, unknown> = Record<string, unknown>,
	Meta = unknown
> = Entry<Data, Meta>;
