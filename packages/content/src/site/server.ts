import { prerender, query } from '$app/server';
import type { ContentMode } from '../server.ts';
import type { Site, SiteMeta } from './site.ts';
import type { SearchHit } from './search.ts';
import type { PageView, NavTree } from './types.ts';

const string_arg = {
	['~standard']: {
		version: 1 as const,
		vendor: 'ogygia-content',
		validate(value: unknown) {
			if (typeof value === 'string') return { value };
			return { issues: [{ message: 'Expected string' }] };
		}
	}
};

const optional_string_arg = {
	['~standard']: {
		version: 1 as const,
		vendor: 'ogygia-content',
		validate(value: unknown) {
			if (value === undefined || typeof value === 'string') return { value };
			return { issues: [{ message: 'Expected string or undefined' }] };
		}
	}
};

export type SiteRemotes = {
	/**
	 * The nav tree as a prerendered remote — awaited by an island sidebar. On a `dimensions()` site
	 * pass a slug (or bare coordinate prefix like `'kit/'`) to get THAT coordinate's tree; no
	 * argument (or `''`) is the default coordinate. Prerendered per distinct argument.
	 */
	nav: (slug?: string) => Promise<NavTree>;
	/** The whole SHELL bundle (`{ nav, switcher, data }`) as ONE prerendered remote — feed it straight
	 *  to `<Shell {meta}>` so the layout never imports the corpus. On a `dimensions()` site, pass the
	 *  slug for that coordinate's tree + switcher. */
	meta: (slug?: string) => Promise<SiteMeta>;
	/** On-demand full-text search over the wire (query mode) — server brain, corpus stays server-side. */
	search: (q: string) => Promise<SearchHit[]>;
	/** One page view over the wire (query mode). The entry's lazy `body` region crosses as a signed
	 *  ticket via the app's `transport` hook (universal hooks) and `<Doc>`/`<Region>` renders it. */
	page: (slug: string) => Promise<PageView | null>;
};

/**
 * Mint a site's Kit remotes: the browser-safe `site()` defines the site once, `remotes(site)` mints
 * its wire access (as `withRemotes()` does for a collection). It imports `$app/server`, so call it
 * from a `.remote.ts`.
 *
 * ```ts
 * // docs.remote.ts
 * import { remotes } from '@ogygia/content/server';
 * import { docs } from './docs';
 * export const { nav, meta, search, page } = remotes(docs, { base: '/docs' });
 * ```
 *
 * `base` is the mount prefix (baked into `nav` hrefs and `search` hit hrefs); default `''` (root
 * mount). `nav` and `meta` take a slug that names the `dimensions()` coordinate; none is the default
 * one. `page` crosses without the entry's server-only `source` reader, its body awaited (rendered).
 *
 * `modes` picks each remote's wire mode (the same dial as `withRemotes`): **`prerender`** (default
 * for `nav` + `doc` — static payloads, required when the awaiting pages prerender; `dynamic: true`
 * keeps runtime resolution for uncovered args) or **`query`** (per-request compute — a preview
 * deployment, a context-gated site). `search` is inherently per-request and always `query`.
 */
export function remotes(
	site: Site,
	opts: { base?: string; modes?: { nav?: ContentMode; page?: ContentMode } } = {}
): SiteRemotes {
	const base = opts.base ?? '';
	const mode = { nav: opts.modes?.nav ?? 'prerender', page: opts.modes?.page ?? 'prerender' };
	const nav_fn = (slug?: string) => site.nav(slug ? { base, slug } : { base });
	const doc_fn = async (slug: string) => {
		const view = await site.page(slug, { base });
		if (!view) return null;
		// @why `source` is a server-only reader (a function), never wire data (test: test/site-reads.test.ts › a page crosses without its source reader, and with its body awaited)
		const { source: _source, ...entry } = view.entry as typeof view.entry & { source?: unknown };
		// @why awaiting the body bakes its SSR HTML, which the transport ships as a ticket (test: test/site-reads.test.ts › a page crosses without its source reader, and with its body awaited)
		// oxlint-disable-next-line typescript/await-thenable -- the body is region()'s AwaitableRegion, typed as the public RegionValue; typing it awaitable is a public type change, owner call
		const body = entry.body ? await entry.body : undefined;
		return { ...view, entry: { ...entry, ...(body ? { body } : {}) } };
	};
	const meta_fn = (slug?: string) => site.meta(slug ? { base, slug } : { base });
	return {
		nav: (mode.nav === 'query'
			? query(optional_string_arg, nav_fn as (arg: unknown) => Promise<NavTree>)
			: prerender(optional_string_arg, nav_fn as (arg: unknown) => Promise<NavTree>, {
					dynamic: true
				})) as unknown as (slug?: string) => Promise<NavTree>,
		meta: (mode.nav === 'query'
			? query(optional_string_arg, meta_fn as (arg: unknown) => Promise<SiteMeta>)
			: prerender(optional_string_arg, meta_fn as (arg: unknown) => Promise<SiteMeta>, {
					dynamic: true
				})) as unknown as (slug?: string) => Promise<SiteMeta>,
		search: query(string_arg, ((q: string) => site.search(q, { base })) as (
			arg: unknown
		) => Promise<SearchHit[]>) as unknown as (q: string) => Promise<SearchHit[]>,
		page: (mode.page === 'query'
			? query(string_arg, doc_fn as (arg: unknown) => Promise<PageView | null>)
			: prerender(string_arg, doc_fn as (arg: unknown) => Promise<PageView | null>, {
					dynamic: true
				})) as unknown as (slug: string) => Promise<PageView | null>
	};
}
