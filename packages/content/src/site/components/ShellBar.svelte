<!--
@component
The docs shell's mobile chrome, one island (the sheet's open state cannot bind across islands, and
the nav arrives as data). A bottom bar with search, theme and menu over one sheet with two views:
search opens the search view, menu the nav view (the contents tree and the footer actions).
Switching while open keeps the sheet open: the views crossfade and the height glides between them,
both skipped under reduced motion.
-->
<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { scope, type Scope } from '@ogygia/machine';
	import { fade } from 'svelte/transition';
	import BottomBar from './BottomBar.svelte';
	import Sheet from './Sheet.svelte';
	import Sidebar from './Sidebar.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import Search from './Search.svelte';
	import type { NavTree } from '../types.ts';

	let {
		nav,
		base = '',
		home,
		brand = 'Docs',
		actions,
		top
	}: {
		nav: NavTree;
		base?: string;
		/** Where the brand links. Defaults to `base` (the docs root). */
		home?: string;
		brand?: string;
		/** Header tools (a PORTABLE snippet) — cross the island boundary and come alive in the footer. */
		actions?: import('svelte').Snippet;
		/** The sidebar's top (the Shell's `side` snippet, portable like `actions`): pinned above the
		 *  nav tree in the NAV view, since on mobile this sheet IS the sidebar. */
		top?: import('svelte').Snippet;
	} = $props();

	let open = $state(false);
	let view = $state<'nav' | 'search'>('nav');
	let swap_el = $state<HTMLElement | undefined>();
	// @why a view switch's frames and glide belong to the bar: they end when it unmounts (test: test/browser/shell-bar.test.ts › lets go of a switch in flight when it unmounts)
	const owner = scope();
	onDestroy(() => owner.close());
	let glide: Scope | null = null;

	const reduced = () =>
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	// @why pin the old height, render the new view, glide to its height, then back to auto: no jump (test: test/browser/shell-bar.test.ts › holds the height through a glide, then lets go when it ends)
	async function set_view(v: 'nav' | 'search') {
		if (view === v) return;
		const el = swap_el;
		// @why reduced motion: an instant swap (test: test/browser/shell-bar.test.ts › swaps at once under reduced motion: no height is pinned)
		if (!open || !el || reduced()) {
			view = v;
			return;
		}
		const h0 = el.offsetHeight;
		view = v;
		await tick();
		const target = el.lastElementChild as HTMLElement | null;
		const h1 = target?.offsetHeight ?? h0;
		glide?.close();
		const g = (glide = owner.child());
		el.style.height = `${h0}px`;
		g.defer(() => (el.style.height = ''));
		g.timeout(
			() =>
				g.timeout(() => {
					el.style.height = `${h1}px`;
					// @why no glide when the heights match or the skin has no height transition: nothing will end it (test: test/browser/shell-bar.test.ts › lets go of the pinned height when no glide runs)
					const glided = el
						.getAnimations?.()
						.find(
							(a) =>
								typeof CSSTransition !== 'undefined' &&
								a instanceof CSSTransition &&
								a.transitionProperty === 'height'
						);
					if (!glided) return g.close();
					glided.finished.then(
						() => g.close(),
						() => g.close()
					);
				}, 'frame'),
			'frame'
		);
	}

	function openMenu() {
		if (open) void set_view('nav'); // ok: a view switch only waits a tick and sets styles
		else {
			view = 'nav';
			open = true;
		}
	}
	function openSearch() {
		if (open) void set_view('search'); // ok: a view switch only waits a tick and sets styles
		else {
			view = 'search';
			open = true;
		}
	}
</script>

<BottomBar>
	{#snippet lead()}
		<a class="og-cbar-brand" href={home || base || '/'}>{brand}</a>
	{/snippet}
	{#snippet actions()}
		<button
			type="button"
			class="og-cbar-btn"
			data-ph-sheet-toggle
			aria-label={open && view === 'search' ? 'Close search' : 'Search'}
			aria-expanded={open && view === 'search'}
			onclick={() => (open && view === 'search' ? (open = false) : openSearch())}
		>
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
			>
		</button>
		<ThemeToggle />
		<button
			type="button"
			class="og-cbar-btn og-cbar-menu"
			data-ph-sheet-toggle
			aria-label={open && view === 'nav' ? 'Close menu' : 'Open menu'}
			aria-expanded={open && view === 'nav'}
			onclick={() => (open && view === 'nav' ? (open = false) : openMenu())}
		>
			<span class="og-cbar-bars" class:og-open={open && view === 'nav'}
				><span></span><span></span><span></span></span
			>
		</button>
	{/snippet}
</BottomBar>

<!-- ONE sheet, two views. Switching views crossfades the content while the wrapper's height glides
     (see set_view) — never a close/reopen, never a height jump. -->
<Sheet bind:open label={view === 'search' ? 'Search' : 'Navigation'}>
	<!-- The bar is kept across navigations, so a link picked here closes the sheet itself (test:
	     apps/docs/e2e/shellbar-keep.spec.ts). -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="og-sheet-swap"
		bind:this={swap_el}
		onclick={(e) => {
			// (only a click that navigates this tab: one that opens elsewhere, or that a handler
			// prevented, leaves the visitor here with the menu still open)
			if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
				return;
			const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
			if (a && !a.hasAttribute('download') && (a.getAttribute('target') ?? '_self') === '_self')
				open = false;
		}}
	>
		{#key view}
			<div
				class="og-sheet-view"
				in:fade={{ duration: reduced() ? 0 : 160 }}
				out:fade={{ duration: reduced() ? 0 : 110 }}
			>
				{#if view === 'search'}
					<!-- The dedicated SEARCH view: just the inline brick — the input gets the surface. -->
					<div class="og-sheet-scroll">
						<div class="og-cbar-search"><Search {base} mode="inline" placeholder="Search…" /></div>
					</div>
				{:else}
					<!-- The NAV view is just the contents tree — the page outline lives IN the page
					     (Doc's mobile inline "On this page"), not buried in the nav sheet. The sidebar's
					     top (`side`) stays pinned above it while the tree scrolls. -->
					{#if top}<div class="og-sheet-top">{@render top()}</div>{/if}
					<div class="og-sheet-scroll">
						<Sidebar {nav} {base} />
					</div>
				{/if}
			</div>
		{/key}
	</div>

	{#snippet footer()}
		{#if view === 'nav' && actions}<div class="og-cbar-actions">{@render actions()}</div>{/if}
	{/snippet}
</Sheet>

<svelte:window onhashchange={() => (open = false)} />
