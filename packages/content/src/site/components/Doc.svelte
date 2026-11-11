<!--
@component
One whole doc page, a pure function of a `PageView`: crumbs, section eyebrow, title, the body region
(islands inside hydrate normally), suggested reading, pager, and the on-page outline. Every piece is
removable by prop; the first page is `<Doc view={await docs.page(slug)} />`. The document title is
"Page — Site" when the shell names a site, else the page alone.
-->
<script lang="ts">
	import { Region } from '@ogygia/core';
	import Pager from './Pager.svelte';
	import OnThisPage from './OnThisPage.svelte' with { wake: 'load' };
	import CodeChrome from './CodeChrome.svelte' with { wake: 'load' };
	import { get_shell_context } from '../context.ts';
	import type { PageView, NavRef } from '../types.ts';

	let {
		view,
		crumbs = false,
		toc = true,
		pager = true,
		suggested = true,
		keepReading,
		eyebrow,
		footer
	}: {
		view: PageView;
		/** The breadcrumb trail. Off by default: the section eyebrow already names the section; turn it
		 *  on for deep trees that need the path. */
		crumbs?: boolean;
		toc?: boolean;
		pager?: boolean;
		suggested?: boolean;
		/** Refs for the "keep reading" cards. Defaults to the trail's policy-selected `suggested`;
		 *  pass `view.trail.related` to show curated links only (when a pager already covers order). */
		keepReading?: NavRef[];
		/** Override the eyebrow text (defaults to the section label) — e.g. "SVELTE • RUNES" on a
		 *  dimensioned site where the coordinate belongs in it. */
		eyebrow?: string;
		/** Rendered between the body and the pager — page-meta chrome ("Edit this page", llms.txt). */
		footer?: import('svelte').Snippet;
	} = $props();

	const data = $derived(view.entry.data as { title?: string; summary?: string });
	const title = $derived(data.title ?? view.slug);
	const reading = $derived(keepReading ?? view.trail.suggested);

	const shell = get_shell_context();
	const doc_title = $derived(shell?.title ? `${title} — ${shell.title}` : title);
</script>

<svelte:head>
	<title>{doc_title}</title>
	{#if data.summary}<meta name="description" content={data.summary} />{/if}
</svelte:head>

<div class="og-doc">
	<article class="og-article">
		{#if crumbs && view.crumbs.length > 1}
			<nav class="og-crumbs" aria-label="Breadcrumb">
				{#each view.crumbs as c (c.label)}<span class="og-crumb">{c.label}</span>{/each}
			</nav>
		{/if}
		{#if eyebrow ?? view.section}<p class="og-eyebrow">{eyebrow ?? view.section}</p>{/if}
		<h1 class="og-title">{title}</h1>
		{#if data.summary}<p class="og-summary">{data.summary}</p>{/if}

		{#if toc && view.headings.length}
			<!-- MOBILE-ONLY "On this page": inline under the heading (the desktop rail is hidden there,
			     and a page outline belongs with the page — not buried in the nav sheet). Open by
			     default (the outline is the point); a native <details>, so it costs no JS and the
			     reader can still collapse it. -->
			<details class="og-mtoc" open>
				<summary class="og-mtoc-summary">On this page</summary>
				<ul class="og-toc-list">
					{#each view.headings as h (h.id)}
						<li class={`og-toc-item og-toc-d${h.depth}`}>
							<a class="og-toc-link" href={`#${h.id}`}>{h.text}</a>
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		{#if view.fallback}
			<div class="og-fallback" role="note">
				This page isn’t available in <b>{view.fallback.from}</b> yet — showing
				<b>{view.fallback.to}</b>.
			</div>
		{/if}

		{#if view.entry.body}
			<div class="og-body"><Region of={view.entry.body} /></div>
			<CodeChrome />
		{/if}

		{#if footer}<div class="og-doc-footer">{@render footer()}</div>{/if}

		{#if suggested && reading.length}
			<nav class="og-suggested" aria-label="Keep reading">
				<p class="og-suggested-label">Keep reading</p>
				<ul class="og-suggested-list">
					{#each reading as r (r.slug)}
						<li>
							<a class="og-suggested-card" href={r.href}>
								<span class="og-suggested-title">{r.title}</span>
								{#if r.summary}<span class="og-suggested-summary">{r.summary}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			</nav>
		{/if}

		{#if pager}<Pager trail={view.trail} />{/if}
	</article>
	{#if toc}
		<!-- Always present (not gated on headings): the outline starts with the page TITLE, so even a
		     heading-less page keeps the rail — consistent chrome page to page (svelte.dev's model). -->
		<aside class="og-aside" aria-label="On this page">
			<OnThisPage {title} headings={view.headings} />
		</aside>
	{/if}
</div>

<style>
	/* The inline outline is the MOBILE face of "on this page" (the rail takes over ≥901px — the
	   shell's breakpoint). Structure only; paint belongs to the theme/skin. */
	.og-mtoc {
		display: none;
	}
	@media (max-width: 900px) {
		.og-mtoc {
			display: block;
		}
	}
</style>
