<!--
@component
The page frame: a sidebar beside the main content, with an optional header and footer. For each
region, pass a component to replace it, `false` or `null` to remove it, or nothing for the default
(the `Sidebar` with the site's nav tree; no header or footer). Sets the shell context (the site and
its mount base), so components inside find the site without passing it down. Starts with a skip
link to `<main>`.

```svelte
<Frame {site}>{@render children()}</Frame>
<Frame {site} sidebar={MySidebar} footer={null}>…</Frame>
```
-->
<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { page } from '$app/state';
	import { set_shell_context } from '../context.ts';
	import { mountBase, type Site } from '../site.ts';
	import type { NavTree } from '../types.ts';
	import Sidebar from './Sidebar.svelte' with { wake: 'load' };

	type Region = Component<{ site: Site }> | false | null | undefined;

	let {
		site,
		base,
		header,
		sidebar,
		footer,
		children
	}: {
		site: Site;
		/** Mount prefix override. Default: derived by subtraction from the current page (catch-all). */
		base?: string;
		/** Top region — no default; provide a component to have one. */
		header?: Region;
		/** Side region — defaults to the `Sidebar` brick; component replaces, `false`/`null` removes. */
		sidebar?: Region;
		/** Bottom region — no default. */
		footer?: Region;
		children: Snippet;
	} = $props();

	// svelte-ignore state_referenced_locally
	const the_base = base ?? mountBase(page.url, page.params.slug ?? '');
	// svelte-ignore state_referenced_locally
	set_shell_context({ site, base: the_base, components: site.components });

	// svelte-ignore state_referenced_locally
	const tree: NavTree =
		sidebar === undefined ? await site.nav({ base: the_base, slug: page.params.slug ?? '' }) : [];
</script>

<div class="og-shell">
	<a class="og-skip" href="#og-main">Skip to content</a>
	{#if header}
		{@const H = header}
		<header class="og-header"><H {site} /></header>
	{/if}
	<div class="og-frame">
		{#if sidebar !== false && sidebar !== null}
			<aside class="og-side">
				{#if sidebar}
					{@const S = sidebar}
					<S {site} />
				{:else}
					<Sidebar nav={tree} base={the_base} />
				{/if}
			</aside>
		{/if}
		<main class="og-main" id="og-main" tabindex="-1">{@render children()}</main>
	</div>
	{#if footer}
		{@const F = footer}
		<footer class="og-footer"><F {site} /></footer>
	{/if}
</div>
