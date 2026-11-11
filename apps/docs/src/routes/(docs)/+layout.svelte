<script lang="ts">
	// The ONE display face: the LCP brand h1 and the `ogygia` wordmark. It is `font-display: swap` and
	// preloaded, so the wordmark is the SAME serif on every page (an `optional` display face fell back
	// to Georgia on some cold loads and not others) and the brand h1 swaps in early.
	import geistSerifUrl from '$lib/fonts/geist-serif-latin.woff2?url';
	import fontsMonoUrl from '../../fonts-mono.css?url';
	import '../../fonts.css';
	import '../../app.css';
	import '$lib/styles/site-chrome.css';
	// The WHOLE site chrome — homepage and docs alike — DOGFOODS the ogygia `Shell`, in the site's
	// own skin (never ogygia theme.css). An empty `header` snippet removes the top header, so the
	// floating sidebar panel is the chrome: brand row (`side` snippet), search, theme toggle, and the
	// docs nav — exactly the shape the bespoke SideNav had, now rendered by the Shell's built-ins.
	import DocsShell from '@ogygia/content/docs-shell';
	import '@ogygia/content/shell.css'; // layout FORM only (@layer ogygia — the unlayered skin wins)
	import '$lib/styles/shell-skin.css'; // the site's LOOK on the .ph-* hooks
	import SiteHeader from '$lib/SiteHeader.svelte';
	import * as ogygia from 'ogygia';
	import { page } from '$app/state';
	import { meta } from '$lib/docs.remote';
	import { sectionNav, sectionOf } from '$lib/sections';
	// The package switcher: a Bits UI dropdown of links. An island, like the shell's own Bits UI
	// pieces (the version switcher, the sheet), so it hydrates on load and again after each nav.
	import SectionSwitcher from '$lib/SectionSwitcher.svelte' with { wake: 'load' };

	let { children } = $props();

	// `/demo/*` routes are standalone canvases (embedded in docs via <iframe>) — no site chrome.
	const bare = page.url.pathname.startsWith('/demo/');
	// The homepage is a marketing page: full-viewport, no docs sidebar — its own slim top-nav instead.
	const isHome = page.url.pathname === '/';
	// The test report: wide tables, so the homepage's full-width frame rather than the docs sidebar.
	const isTests = /^\/tests(\/|$)/.test(page.url.pathname);
	// Breadcrumb after the wordmark: `ogygia │ Docs` / `ogygia │ Tests`; nothing on the homepage.
	const section = isHome ? null : isTests ? 'Tests' : 'Docs';

	// The leak-free shell bundle (nav + switcher) — docs pages only. Skipped on the homepage (no
	// sidebar) and bare canvases, which also saves the nav-tree fetch there. csr=false → every nav is
	// a fresh SSR pass, so a top-level await is current per page.
	const fullMeta = bare || isHome || isTests ? null : await meta(page.params.slug ?? '');
	// One section per package: the sidebar (and the mobile sheet) show the current section's part
	// of the one nav tree; the switcher at the top of the sidebar moves between sections.
	const docSection = sectionOf(page.params.slug ?? '');
	const shellMeta = fullMeta && { ...fullMeta, nav: sectionNav(fullMeta.nav, docSection) };

	// No-flash theme: apply a saved forced theme before first paint. `ogygia.script` serializes
	// the self-contained function into a safe inline <script> (no `String.fromCharCode` gymnastics).
	const themeTag = ogygia.script(() => {
		try {
			const t = localStorage.getItem('ogygia-theme');
			if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
		} catch {
			/* private mode */
		}
	});

	// Deferred JetBrains Mono: load after window load / idle so ui-monospace covers hero code first.
	// The hashed URL is closed-over data, so it is passed as an arg (serialized for the inline script).
	const monoTag = ogygia.script((href: string) => {
		const load = () => {
			const e = document.createElement('link');
			e.rel = 'stylesheet';
			e.href = href;
			document.head.appendChild(e);
		};
		const schedule = () =>
			'requestIdleCallback' in window
				? requestIdleCallback(load, { timeout: 2500 })
				: setTimeout(load, 1);
		if (document.readyState === 'complete') schedule();
		else window.addEventListener('load', schedule, { once: true });
	}, fontsMonoUrl);
</script>

<svelte:head>
	<link rel="preload" href={geistSerifUrl} as="font" type="font/woff2" crossorigin="anonymous" />
	{@html themeTag}
	{@html monoTag}
</svelte:head>

{#if bare}
	{@render children()}
{:else if isHome || isTests}
	<!-- Marketing homepage and the test report: the shared header + full-width content, no docs
	     sidebar. The header is FIXED, so the content clears its height. -->
	<div class="home-page" data-sveltekit-preload-data="hover">
		<SiteHeader {section} />
		{@render children()}
	</div>
{:else}
	<!-- Docs: the SAME shared header on top (DocsShell's `header` snippet), so the sidebar carries only
	     the nav — `tools={null}` drops the panel-chrome search/theme, now in the header. -->
	<div data-sveltekit-preload-data="hover">
		<DocsShell meta={shellMeta!} base="/docs" home="/" title="ogygia" tools={null}>
			{#snippet header()}
				<SiteHeader section="Docs" />
			{/snippet}
			<!-- The section switcher heads the sidebar (desktop) and the bottom bar's nav sheet (phone). -->
			{#snippet side()}
				<SectionSwitcher current={docSection} />
			{/snippet}
			{@render children()}
		</DocsShell>
	</div>
{/if}

<style>
	/* The header is fixed (out of flow) so the elastic overscroll can't drag it — the homepage content
	   clears its height. (Docs clears it via .og-cframe.) */
	:global(.home-page) {
		padding-top: 3.5rem;
	}
</style>
