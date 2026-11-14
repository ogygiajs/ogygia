<!--
@component
LateIsland.svelte, for an app that runs Svelte's async mode: the build imports this one in its place
(vite/late-island.ts). The load is awaited, so the navigation's update batch waits for it and Kit
keeps the old page until the island's code is in, then swaps the whole new page at once. Without
async mode this file does not compile, which is why it is never the default. A failed load renders
nothing, and says `island_load_failed`.
-->
<script lang="ts">
	import { untrack, type Component as Loaded, type Snippet } from 'svelte';
	import { OgygiaError } from './messages/island.ts';

	interface Props {
		load: () => Promise<Loaded>;
		props: Record<string, unknown>;
		children?: Snippet;
	}

	let { load, props, children }: Props = $props();
	const Component = await untrack(() => load()).catch((error) => {
		console.error(new OgygiaError('island_load_failed', { entry: null }), error);
		return undefined;
	});
</script>

{#if Component}<Component {...props}>{@render children?.()}</Component>{/if}
