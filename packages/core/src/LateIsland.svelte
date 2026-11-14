<!--
@component
An inline island a client navigation created: Kit made its wrapper in the browser, with no rendered
stamp, so its component was not loaded yet. It loads it and renders it when it lands: the navigation
shows an empty place first, then the island (a client render, nothing to mismatch). A failed load
renders nothing, and says `island_load_failed`.

Where the app runs Svelte's async mode, the build imports LateIslandAwait.svelte in this one's place
(vite/late-island.ts).
-->
<script lang="ts">
	import { onDestroy, untrack, type Component as Loaded, type Snippet } from 'svelte';
	import { scope, STALE } from '@ogygia/machine';
	import { OgygiaError } from './messages/island.ts';

	interface Props {
		load: () => Promise<Loaded>;
		props: Record<string, unknown>;
		children?: Snippet;
	}

	let { load, props, children }: Props = $props();
	let Component: Loaded | undefined = $state(undefined);
	const shown = scope();
	onDestroy(() => shown.close());
	shown
		.task(() => untrack(() => load()))
		.then(
			(c) => {
				if (c !== STALE) Component = c;
			},
			(error) => console.error(new OgygiaError('island_load_failed', { entry: null }), error)
		);
</script>

{#if Component}<Component {...props}>{@render children?.()}</Component>{/if}
