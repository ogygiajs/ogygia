<!--
@component
The nav tree, drawn: groups nest, leaves link, plain links pass through. Pass the tree as `nav` (a
precomputed tree: transform it and hand it back), or a `site` to read it from. Draw a leaf yourself
with the `item` snippet; style the rest through the `.og-*` classes.
-->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { scope, storage } from '@ogygia/machine';
	import { get_shell_context } from '../context.ts';
	import { roving } from './roving.ts';
	import type { Site } from '../site.ts';
	import type { NavLeaf, NavTree } from '../types.ts';

	const NON_IDENT_CHARS_G = /[^a-zA-Z0-9_-]+/g;

	let {
		site,
		base,
		nav,
		item
	}: {
		site?: Site;
		base?: string;
		nav?: NavTree;
		/** Draw one leaf yourself: `{#snippet item(leaf, active)}…{/snippet}`. */
		item?: Snippet<[NavLeaf, boolean]>;
	} = $props();

	const ctx = get_shell_context();
	const the_base = $derived(base ?? ctx?.base ?? '');
	const fetched: NavTree = await untrack(() => {
		const from = site ?? ctx?.site;
		return nav || !from ? [] : from.nav({ base: the_base });
	});
	// @why a kept sidebar gets each page's tree as a new `nav` prop, without a re-mount (test: apps/docs/e2e/sidebar-keep.spec.ts › the sidebar is the same element after a navigation to another section, with the new tree)
	const tree: NavTree = $derived(nav ?? fetched);

	const path = $derived(page.url.pathname);

	function vt_name(prefix: string, key: string): string {
		// @why each row is its own view-transition layer, so the active chip glides beneath the labels (test: test/browser/sidebar.test.ts › gives every row its own view-transition name, a valid identifier)
		return `${prefix}-${key.replace(NON_IDENT_CHARS_G, '-')}`;
	}

	let nav_el: HTMLElement | null = $state(null);
	let scroller: HTMLElement | null = null;
	const save = () => {
		if (scroller) {
			try {
				storage.session()?.setItem(`og:sidenav:${the_base}`, String(scroller.scrollTop));
			} catch {
				// ok: no storage (private mode); the scroll position is not kept
			}
		}
	};
	function find_scroller(from: HTMLElement): HTMLElement | null {
		let el: HTMLElement | null = from;
		while (el && el !== document.body) {
			const o = getComputedStyle(el).overflowY;
			if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) return el;
			el = el.parentElement;
		}
		return null;
	}
	let first_sync = true;
	$effect(() => {
		void path;
		const el = nav_el;
		if (!el || el.offsetParent === null) return;
		scroller = find_scroller(el);
		if (!scroller) return;
		// @why the panel is the skin's, so the saver goes with the sidebar, not the panel (test: test/browser/sidebar.test.ts › lets go of the panel when it unmounts: scrolling the panel after saves nothing)
		const run = scope();
		run.on(scroller, 'scroll', save, { passive: true });
		let saved: number | null = null;
		try {
			const raw = storage.session()?.getItem(`og:sidenav:${the_base}`);
			saved = raw == null ? null : Number(raw);
		} catch {
			// ok: no storage (private mode); the scroll position is not kept
		}
		if (saved != null && Number.isFinite(saved)) scroller.scrollTop = saved;
		const active = el.querySelector<HTMLElement>('[aria-current="page"]');
		if (active) {
			const s_rect = scroller.getBoundingClientRect();
			const a_rect = active.getBoundingClientRect();
			const outside = a_rect.top < s_rect.top || a_rect.bottom > s_rect.bottom;
			// @why an active row out of view is centered in the panel (test: test/browser/sidebar.test.ts › centers the active row in the panel when it starts out of view)
			if (outside || (first_sync && saved == null)) {
				const target =
					scroller.scrollTop + (a_rect.top - s_rect.top) - s_rect.height / 2 + a_rect.height / 2;
				// @why the panel scrolls, never the page, as scrollIntoView would (test: test/browser/sidebar.test.ts › moves only the panel, never the page)
				scroller.scrollTo({
					top: Math.max(0, target),
					behavior: first_sync ? 'instant' : 'smooth'
				});
				save();
			}
		}
		first_sync = false;
		return () => run.close();
	});
</script>

{#snippet items(list: NavTree)}
	<ul class="og-nav-list">
		{#each list as node (node.kind === 'link' ? `L${node.href}` : node.kind === 'group' ? `G${node.label}` : node.slug)}
			{#if node.kind === 'group'}
				<li class="og-nav-group">
					<span class="og-nav-label" style="view-transition-name: {vt_name('phg', node.label)}"
						>{node.label}{#if node.badge}<span class="og-badge">{node.badge}</span>{/if}</span
					>
					{@render items(node.items)}
				</li>
			{:else if node.kind === 'link'}
				<li>
					<a
						class="og-nav-link og-nav-external"
						style="view-transition-name: {vt_name('phx', node.href)}"
						href={node.href}>{node.label}</a
					>
				</li>
			{:else if item}
				<li>{@render item(node, path === node.href)}</li>
			{:else}
				<li>
					<a
						class="og-nav-link"
						class:og-active={path === node.href}
						aria-current={path === node.href ? 'page' : undefined}
						href={node.href}
						style="view-transition-name: {vt_name('phl', node.href)}"
					>
						<!-- The gliding highlight box: only the ACTIVE row carries it, and it holds
						     `view-transition-name: og-nav-active` (in CSS), so the page cross-fade's View
						     Transition slides it from the old active row to the new one. It sits BEHIND the
						     label text and beneath every row's own VT layer (z-index), so it never clips a label. -->
						{#if path === node.href}<span class="og-nav-chip" aria-hidden="true"></span>{/if}
						{node.title}{#if node.badge}<span class="og-badge">{node.badge}</span>{/if}
					</a>
				</li>
			{/if}
		{/each}
	</ul>
{/snippet}

<!-- Roving tabindex: the sidebar is ONE tab stop; Up/Down move between links (entry lands on the
     active page's link). Focus-only — Enter/click navigate natively. -->
<nav
	class="og-sidebar"
	aria-label="Documentation"
	bind:this={nav_el}
	{@attach roving({ selector: '.og-nav-link', orientation: 'vertical' })}
>
	{@render items(tree)}
</nav>
