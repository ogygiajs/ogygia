<script lang="ts" module>
	import { flights, STALE } from '@ogygia/machine';
	import { download, import_again } from '@ogygia/core/internal/instruments';

	const palette = flights({
		name: 'search palette',
		run: import_again(() => import('./SearchPalette.svelte')),
		retry: download
	});
</script>

<!--
@component
Full-text search, the ⌘K command palette. This is the light half, an island: a real link to the search
page (so a page without JS still searches) and the keys that open the palette (⌘K or Ctrl+K, or a
lone `/`). The heavy half (`SearchPalette.svelte`: the dialog, the search worker, the index) loads on
the first intent: a hover, a focus, a click or a key. A page that never searches pays almost nothing.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { on } from 'svelte/events';
	import { get_shell_context } from '../context.ts';
	import type { SearchHit } from '../search.ts';
	import type SearchPaletteT from './SearchPalette.svelte';

	const TEXT_FIELD_TAG_RE = /^(input|textarea|select)$/i;

	let {
		base,
		endpoint,
		query,
		mode = 'dialog',
		action,
		placeholder = 'Search',
		limit = 10
	}: {
		base?: string;
		endpoint?: string;
		query?: (q: string) => Promise<SearchHit[]>;
		/** `'dialog'` (default): the command palette. `'inline'`: the bare input and list, for the mobile
		 *  sheet, which is already the modal; it mounts the palette at once (opening the sheet was the
		 *  intent). */
		mode?: 'dialog' | 'inline';
		/** No-JS fallback URL — a real `/search` page. Default `${base}/search`. */
		action?: string;
		placeholder?: string;
		limit?: number;
	} = $props();

	const ctx = get_shell_context();
	// svelte-ignore state_referenced_locally
	const the_base = base ?? ctx?.base ?? '';
	// svelte-ignore state_referenced_locally
	const search_action = action ?? `${the_base}/search`;

	// svelte-ignore state_referenced_locally
	let open = $state(mode === 'inline');
	let Palette = $state<typeof SearchPaletteT | null>(null);
	// @why an open asked for while the palette loads: a second Ctrl/Cmd+K meanwhile takes it back (test: apps/docs/e2e/search-palette-load.spec.ts › Ctrl/Cmd+K twice while the palette loads leaves it closed)
	let opening = false;

	async function wake_palette(): Promise<boolean> {
		if (Palette) return true;
		try {
			const m = await palette.get();
			if (m === STALE) return false;
			Palette = m.default;
			return true;
		} catch {
			return false; // ok: the palette's chunk did not come: the link still goes to the search page
		}
	}

	async function open_palette(): Promise<boolean> {
		opening = true;
		const loaded = await wake_palette();
		if (loaded && opening) open = true;
		opening = false;
		return loaded;
	}

	onMount(() => {
		if (mode === 'inline') void wake_palette(); // ok: never rejects (a failed download answers false)

		// @why the keys open a dialog; a sheet is already open, so it leaves them to the page (test: test/browser/search.test.ts › in a sheet, mounts the palette at once and leaves the keys to the page)
		if (mode !== 'dialog') return;
		return on(window, 'keydown', (e: KeyboardEvent) => {
			const k = e.key.toLowerCase();
			const el = e.target as HTMLElement | null;
			// @why a slash typed in a field or a code editor (a contenteditable) is text, not a search (test: test/browser/search.test.ts › leaves a slash typed in a text field or an editor alone)
			const typing = TEXT_FIELD_TAG_RE.test(el?.tagName ?? '') || el?.isContentEditable === true;
			if ((e.metaKey || e.ctrlKey) && k === 'k') {
				e.preventDefault();
				if (open) open = false;
				else if (opening) opening = false;
				else void open_palette(); // ok: never rejects (a failed download answers false)
			} else if (k === '/' && !typing && !open && !opening) {
				e.preventDefault();
				void open_palette(); // ok: never rejects (a failed download answers false)
			}
		});
	});
</script>

{#if mode === 'dialog'}
	<!-- A real link to /search — JS intercepts to open the palette; no-JS follows it to the page.
	     Hover/focus WARMS the heavy half (module + worker + index) so the open feels instant: the
	     palette mounts closed and starts fetching while the pointer is still travelling. -->
	<a
		class="og-search-trigger"
		href={search_action}
		onpointerenter={() => void wake_palette()}
		onfocus={() => void wake_palette()}
		onclick={(e) => {
			e.preventDefault();
			// the palette could not load: the link's own page, as without JS
			void open_palette().then((loaded) => {
				if (!loaded) location.assign(search_action);
			});
		}}
	>
		<svg
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
		>
		<span class="og-search-trigger-label">{placeholder}</span>
		<kbd class="og-search-kbd">⌘K</kbd>
	</a>
{/if}

{#if Palette}
	<Palette
		base={the_base}
		{endpoint}
		{query}
		{limit}
		{placeholder}
		action={search_action}
		{mode}
		bind:open
	/>
{/if}
