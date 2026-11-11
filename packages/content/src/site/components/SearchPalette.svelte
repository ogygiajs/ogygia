<!--
@component
The heavy half of search: the Bits UI dialog and command list, and the worker client that loads the
index. `Search` loads it on a visitor's first intent. Mounting it starts the worker client; a custom `query` backend starts none. Typing queries once per
pause; a failure is shown only for the term still in the field, with no results under it. The list
stays mounted, so the field's `aria-controls` always points at it, and is never empty: with nothing
to list it holds one disabled option (the hint, no results, or the error).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { scope, STALE } from '@ogygia/machine';
	import { Command, Dialog } from 'bits-ui';
	import { SearchClient } from '../search-client.ts';
	import type { SearchHit } from '../search.ts';
	import { OgygiaError } from '../../messages/runtime.ts';

	let {
		base = '',
		endpoint,
		query,
		limit = 10,
		placeholder = 'Search',
		action = '/search',
		mode = 'dialog',
		open = $bindable(false)
	}: {
		base?: string;
		endpoint?: string;
		query?: (q: string) => Promise<SearchHit[]>;
		limit?: number;
		placeholder?: string;
		action?: string;
		mode?: 'dialog' | 'inline';
		open?: boolean;
	} = $props();

	let q = $state('');
	let results = $state<SearchHit[]>([]);
	type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string };
	// svelte-ignore state_referenced_locally
	let status = $state<Status>(query ? { kind: 'ready' } : { kind: 'loading' });

	let client: SearchClient | undefined;

	const message_of = (e: unknown) => (e instanceof Error ? e.message : String(e));

	onMount(() => {
		if (query) return;
		client = new SearchClient({ base, ...(endpoint ? { endpoint } : {}), limit });
		client.ready.then(
			() => {
				if (status.kind === 'loading') status = { kind: 'ready' };
			},
			(e: unknown) => {
				status = { kind: 'failed', message: message_of(e) };
				results = [];
				console.error(new OgygiaError('content_search_unavailable'), e);
			}
		);
		return () => client?.destroy();
	});

	function query_failed(error: unknown): void {
		status = { kind: 'failed', message: message_of(error) };
		results = [];
		console.error(new OgygiaError('content_search_query_failed'), error);
	}

	function run_query(term: string): Promise<SearchHit[]> {
		if (query) return query(term);
		return client?.query(term) ?? Promise.resolve([]);
	}

	function searchField(node: HTMLElement) {
		const input = node.querySelector('input');
		if (!input) return;
		const s = scope();
		let cancel: (() => void) | null = null;
		const run = () => {
			const term = input.value.trim();
			cancel?.();
			if (!term) {
				results = [];
				return;
			}
			cancel = s.timeout(async () => {
				let hits: SearchHit[] | typeof STALE;
				try {
					hits = await s.task(() => run_query(term));
				} catch (error) {
					if (input.value.trim() === term) query_failed(error);
					return;
				}
				if (hits === STALE || input.value.trim() !== term) return;
				results = hits;
				status = { kind: 'ready' };
			}, 150);
		};
		s.on(input, 'input', run);
		return () => s.close();
	}
</script>

{#snippet field()}
	<div class="og-search-field" {@attach searchField}>
		<svg
			width="17"
			height="17"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
		>
		<Command.Input
			bind:value={q}
			class="og-search-scene-input"
			{placeholder}
			aria-label={placeholder}
		/>
		<kbd class="og-search-kbd">Esc</kbd>
	</div>
{/snippet}

{#snippet resultsBody()}
	<Command.List class="og-search-scene-body">
		<Command.Viewport>
			{#if status.kind === 'failed'}
				<Command.Item disabled value="__error" class="og-search-error">
					<strong>Search is unavailable.</strong>
					<span>{status.message}</span>
				</Command.Item>
			{:else if results.length}
				{#each results as hit (hit.href)}
					<Command.LinkItem href={hit.href} value={hit.href} class="og-search-hit">
						<span class="og-search-hit-title"
							>{hit.title}{#if hit.heading}<span class="og-search-hit-heading">
									› {hit.heading}</span
								>{/if}</span
						>
						{#if hit.excerpt}<span class="og-search-hit-excerpt">{@html hit.excerpt}</span>{/if}
						<span class="og-search-hit-section">{hit.section}</span>
					</Command.LinkItem>
				{/each}
			{:else if q.trim() && status.kind === 'ready'}
				<Command.Item disabled value="__empty" class="og-search-empty"
					>No results for “{q}”</Command.Item
				>
			{:else}
				<Command.Item disabled value="__hint" class="og-search-hint"
					>Type to search the docs…</Command.Item
				>
			{/if}
		</Command.Viewport>
	</Command.List>
{/snippet}

{#if mode === 'inline'}
	<Command.Root shouldFilter={false} loop class="og-search og-search-inline">
		{@render field()}
		{@render resultsBody()}
	</Command.Root>
{:else}
	<Dialog.Root bind:open>
		<Dialog.Portal>
			<Dialog.Overlay class="og-search-backdrop" />
			<Dialog.Content class="og-search-panel" aria-label={placeholder}>
				<Dialog.Title class="og-sr-only">{placeholder}</Dialog.Title>
				<Command.Root shouldFilter={false} loop class="og-search">
					{@render field()}
					{@render resultsBody()}
				</Command.Root>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{/if}
