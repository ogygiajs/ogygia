<!--
@component
The docs shell: a composition of the site's public bricks. Desktop: a top header (brand, links,
search, theme) over a left sidebar and the content (`Doc` brings its own on-this-page rail). Mobile:
a bottom bar and a slide-up sheet, one island (`ShellBar`).

Every region is a snippet prop. Absent, the built-in renders; a snippet renders instead; passed
nullish (`header={null}`, or a value that came out `undefined`), the region is gone. The regions
nest: replace the whole `header`, or keep it and replace its `brand`, `nav` or `tools`.

Styling is opt-in: the shell ships structure and `.og-*` classes, and imports no CSS. For the stock
look, import the two stylesheets once (in the root layout); for your own, style the classes.

```svelte
<script>
	import '@ogygia/content/theme.css';
	import '@ogygia/content/shell.css';
</script>

<DocsShell {site}>{@render children()}</DocsShell>
```
-->
<script lang="ts">
	import { page } from '$app/state';
	import { script } from '@ogygia/core';
	import { set_shell_context } from '../context.ts';
	import { mountBase, type Site, type SiteMeta } from '../site.ts';
	// @why kept, the sidebar is one element across navigations, so its active chip glides (test: apps/docs/e2e/sidebar-keep.spec.ts › the sidebar is the same element after a navigation to another section, with the new tree)
	import Sidebar from './Sidebar.svelte' with { wake: 'load', keep: 'og-sidebar' };
	import Switcher from './Switcher.svelte' with { wake: 'load' };
	import Search from './Search.svelte' with { wake: 'idle' };
	import ThemeToggle from './ThemeToggle.svelte' with { wake: 'load' };
	import ShellBar from './ShellBar.svelte' with { wake: 'load', keep: 'og-shell-bar' };
	import type { NavTree } from '../types.ts';
	import type { Snippet } from 'svelte';

	type ShellProps = {
		/** The site brains. Pass it and the Shell computes its nav/switcher itself (the simple path).
		 *  OR keep the corpus SERVER-ONLY and pass `meta` DATA instead (the leak-free path) — then no
		 *  route imports the corpus. Exactly one of `site` / `meta` is needed. */
		site?: Site;
		/** The pre-computed shell bundle from `site.meta(slug)` — the leak-free path. When present, the
		 *  Shell uses it and never touches `site`, so a `+layout.svelte` can feed a `meta` remote's
		 *  result and keep the corpus off the client. */
		meta?: SiteMeta;
		/** Brand text in the header (used when the `brand` snippet is absent). */
		title?: string;
		/** Top-nav links (data — they cross into the mobile island, which snippets can't). */
		links?: { text: string; href: string }[];
		/** Mount prefix override; default derived by subtraction from the current page. */
		base?: string;
		/** Where the brand/logo links. Defaults to `base` (the docs root); set `home="/"` for a site
		 *  with a separate marketing home. */
		home?: string;
		/** The skip-to-content link (first tab stop). Default: "Skip to content" → `#og-main`. */
		skip?: Snippet | null;
		/** The whole top header. Nullish → NO header, and the Shell shifts to the panel-chrome form:
		 *  the tools cluster renders INSIDE the sidebar above the nav, so nothing is lost. */
		header?: Snippet | null;
		/** The header's brand region. Default: `<a>` to the mount root carrying `title`. */
		brand?: Snippet | null;
		/** The header's primary-nav region. Default: a link row from `links`. */
		nav?: Snippet | null;
		/** The tools cluster (search, switchers, theme, `actions`) — wherever it lives: the built-in
		 *  header in header mode, the sidebar panel when the header is replaced. */
		tools?: Snippet | null;
		/** Rendered at the TOP of the sidebar, above tools + nav — the panel's brand row. On mobile it
		 *  renders at the top of the bottom bar's nav sheet (the sidebar there), pinned above the tree. */
		side?: Snippet;
		/** The sidebar NAV. Default: the built-in `<Sidebar>` (kept island — roving focus, gliding
		 *  marker). The snippet gets the computed `NavTree` + mount base, so a bespoke sidenav needs
		 *  no extra data plumbing. */
		sidebar?: Snippet<[NavTree, string]> | null;
		/** The mobile chrome (bottom bar + sheet). Default: the built-in `<ShellBar>` island. */
		bar?: Snippet<[NavTree, string]> | null;
		/** Header tools — GitHub, version switcher, socials, anything. Rendered in the desktop header.
		 *  NOT (yet) in the mobile sheet: `actions` is a forwarded snippet-prop, and a forwarded snippet
		 *  can't cross into the `ShellBar` island (it captures as a function → not serializable). The
		 *  fix is to make the mobile sheet SSR + inline-script (non-island) so snippets flow through. */
		actions?: Snippet;
		children: Snippet;
	};

	const props: ShellProps = $props();
	// svelte-ignore state_referenced_locally
	const { site, meta, title = 'Docs', links = [], base, home, side, actions, children } = props;

	function slot<K extends keyof ShellProps>(key: K): NonNullable<ShellProps[K]> | null | undefined {
		// @why a region passed as undefined is gone, like null; only an absent one renders the built-in (test: test/docs-shell.test.ts › drops the header when the prop is passed as undefined, as it does for null)
		if (!(key in props)) return undefined;
		return (props[key] ?? null) as NonNullable<ShellProps[K]> | null;
	}
	const skip = slot('skip');
	const header = slot('header');
	const brand = slot('brand');
	const nav = slot('nav');
	const tools = slot('tools');
	const sidebar = slot('sidebar');
	const bar = slot('bar');

	// svelte-ignore state_referenced_locally
	const the_base = base ?? mountBase(page.url, page.params.slug ?? '');
	const the_home = home ?? the_base;
	// svelte-ignore state_referenced_locally
	set_shell_context({ site, base: the_base, components: site?.components, title });

	// svelte-ignore state_referenced_locally
	const current_slug = page.params.slug ?? '';
	const tree: NavTree = meta ? meta.nav : await site!.nav({ base: the_base, slug: current_slug });
	const switcher = meta
		? meta.switcher
		: ((await site?.switcher(current_slug, { base: the_base })) ?? null);
</script>

<svelte:head>
	{@html script((k: string) => {
		try {
			var t = localStorage.getItem(k);
			if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
		} catch (e) {
			// ok: no storage (a private window); the page keeps its default theme
		}
	}, 'og-theme')}
</svelte:head>

<div class="og-shell" class:og-headerless={header !== undefined}>
	<!-- Every region below follows ONE pattern:
	     {#if x}{@render x()}{:else if x !== null}built-in{/if}
	     — absent = batteries-included, a snippet = yours, null = gone. -->
	{#if skip}{@render skip()}{:else if skip !== null}
		<!-- First focusable element: keyboard users jump past the nav straight to the content. -->
		<a class="og-skip" href="#og-main">Skip to content</a>
	{/if}
	{#if header}
		{@render header()}
	{:else if header !== null}
		<header class="og-cheader">
			{#if brand}{@render brand()}{:else if brand !== null}
				<a class="og-cheader-brand" href={the_home || '/'}>{title}</a>
			{/if}
			<!-- Version sits by the brand (it scopes the whole doc set); locale rides with the tools. -->
			{#if switcher}<Switcher {switcher} for="version" />{/if}
			{#if nav}{@render nav()}{:else if nav !== null}
				<nav class="og-cheader-nav" aria-label="Primary">
					{#each links as l (l.href)}<a class="og-cheader-link" href={l.href}>{l.text}</a>{/each}
				</nav>
			{/if}
			{#if tools}{@render tools()}{:else if tools !== null}
				<div class="og-cheader-tools">
					<div class="og-cheader-search"><Search base={the_base} /></div>
					{#if switcher}<Switcher {switcher} for="locale" />{/if}
					<ThemeToggle />
					{#if actions}<div class="og-cheader-actions">{@render actions()}</div>{/if}
				</div>
			{/if}
		</header>
	{/if}

	<div class="og-cframe">
		<aside class="og-cside" aria-label="Documentation">
			{#if header !== undefined}
				<!-- Panel-chrome form: the brand row carries the theme toggle (the old floating-panel
				     shape — wordmark left, quiet icon buttons right), search rides below. -->
				{#if side || tools === undefined}
					<div class="og-cside-brand">
						{#if side}{@render side()}{/if}
						{#if tools === undefined}<ThemeToggle />{/if}
					</div>
				{/if}
				{#if tools}{@render tools()}{:else if tools !== null}
					<div class="og-cside-tools">
						{#if switcher}<Switcher {switcher} for="version" />{/if}
						<div class="og-cside-search"><Search base={the_base} /></div>
						{#if switcher}<Switcher {switcher} for="locale" />{/if}
						{#if actions}<div class="og-cside-actions">{@render actions()}</div>{/if}
					</div>
				{/if}
			{:else if side}
				<div class="og-cside-brand">{@render side()}</div>
			{/if}
			{#if sidebar}
				{@render sidebar(tree, the_base)}
			{:else if sidebar !== null}
				<Sidebar nav={tree} base={the_base} />
			{/if}
		</aside>
		<main class="og-cmain" id="og-main" tabindex="-1">{@render children()}</main>
	</div>

	<!-- The mobile island. `actions` is a portable snippet (the compiler made it one at the consumer's
	     call site), so it crosses into the island as a descriptor and comes alive in the sheet footer. -->
	{#if bar}
		{@render bar(tree, the_base)}
	{:else if bar !== null}
		<ShellBar nav={tree} base={the_base} home={the_home} brand={title} {actions} top={side} />
	{/if}
</div>
