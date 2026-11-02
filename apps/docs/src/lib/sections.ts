/**
 * The docs sections: one per published package. `ogygia` (the package apps install) is the main
 * section and owns the bare addresses (`/docs/regions/…`); every other package owns the folder named
 * by its `key` (`/docs/devtools/…`, from `content/docs/NN-devtools/`). The nav tree stays ONE tree
 * (search, llms.txt and the sitemap read all of it); the shell shows the current section's part of
 * it, and the header switcher moves between sections. Browser-safe data, no imports.
 */
import type { NavItem, NavRef, NavTree } from '@ogygia/content';

export type Section = {
	/** The address prefix (`''` for the main section). */
	key: string;
	/** The npm package name, as the switcher shows it. */
	name: string;
	/** One line on what the package is for. */
	blurb: string;
	/** The section's first page. */
	home: string;
};

export const SECTIONS: Section[] = [
	{
		key: '',
		name: 'ogygia',
		blurb: 'Regions, rendering, the SPA router, data and state',
		home: '/docs/start/overview'
	},
	{
		key: 'content',
		name: '@ogygia/content',
		blurb: 'Collections, markdown, docs sites and search',
		home: '/docs/content/overview'
	},
	{
		key: 'router',
		name: '@ogygia/router',
		blurb: 'The server router: routes as values, typed',
		home: '/docs/router/overview'
	},
	{
		key: 'postrender',
		name: '@ogygia/postrender',
		blurb: 'Prerender at request time, served as bytes',
		home: '/docs/postrender/overview'
	},
	{
		key: 'devtools',
		name: '@ogygia/devtools',
		blurb: 'The in-page dock and the SSR profiler',
		home: '/docs/devtools/overview'
	},
	{
		key: 'testing',
		name: '@ogygia/testing',
		blurb: 'Performance and hydration checks in your tests',
		home: '/docs/testing/overview'
	},
	{
		key: 'flags',
		name: '@ogygia/flags',
		blurb: 'Feature flags and A/B tests, decided on the server',
		home: '/docs/flags/overview'
	},
	{
		key: 'federation',
		name: '@ogygia/federation',
		blurb: 'Pages and widgets shared between apps',
		home: '/docs/federation/overview'
	},
	{
		key: 'cli',
		name: '@ogygia/cli',
		blurb: 'Setup, the AI skill, perf budgets, keys',
		home: '/docs/cli/overview'
	},
	{
		key: 'core',
		name: '@ogygia/core',
		blurb: 'The shared core, for plugin authors',
		home: '/docs/core/overview'
	}
];

const PACKAGE_KEYS = new Set(SECTIONS.map((s) => s.key).filter(Boolean));

/** The section key a docs slug belongs to (`'devtools/dock'` → `'devtools'`, `'regions/lakes'` → `''`). */
export function sectionOf(slug: string): string {
	const first = slug.replace(/^\/+/, '').split('/')[0] ?? '';
	return PACKAGE_KEYS.has(first) ? first : '';
}

/** The section of a ref's slug, or of a href under `/docs`. */
function section_of_ref(ref: NavRef | undefined): string | null {
	return ref ? sectionOf(ref.slug) : null;
}

/** The first leaf slug under a nav item (a section's top-level group is found by its pages). */
function first_slug(item: NavItem): string | null {
	if (item.kind === 'leaf') return item.slug;
	if (item.kind === 'group') {
		for (const child of item.items) {
			const s = first_slug(child);
			if (s !== null) return s;
		}
	}
	return null;
}

/**
 * The part of the whole-site nav tree one section shows. A package section is its top-level group's
 * items (the group itself is the section, so its label is not repeated); the main section is every
 * top-level item that belongs to no package.
 */
export function sectionNav(tree: NavTree, key: string): NavTree {
	const belongs = (item: NavItem) => {
		const slug = first_slug(item);
		return slug !== null && sectionOf(slug) === key;
	};
	if (!key) return tree.filter(belongs);
	const group = tree.find((item) => item.kind === 'group' && belongs(item));
	return group && group.kind === 'group' ? group.items : [];
}

/** Drop a prev/next neighbor that sits in another section, so the pager never leaves the package. */
export function sameSection<T extends NavRef | undefined>(here: string, ref: T): T | undefined {
	return section_of_ref(ref) === sectionOf(here) ? ref : undefined;
}
