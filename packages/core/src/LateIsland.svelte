<!--
@component
An inline island a client navigation created: Kit made its wrapper in the browser, with no rendered
stamp, so its component was not loaded yet. It loads it and renders it when it lands: the navigation
shows an empty place first, then the island (a client render, nothing to mismatch). A failed load
renders nothing, and says `island_load_failed`.

Where the app runs Svelte's async mode, the build imports LateIslandAwait.svelte in this one's place
(vite/late-island.ts).
-->
<script>
	import { OgygiaError } from './messages/island.ts';
	/** @type {{ load: () => Promise<import('svelte').Component>, props: Record<string, unknown>, children?: import('svelte').Snippet }} */
	let { load, props, children } = $props();
	/** @type {import('svelte').Component | undefined} */
	let Component = $state(undefined);
	// svelte-ignore state_referenced_locally
	load().then(
		(c) => (Component = c),
		(error) => console.error(new OgygiaError('island_load_failed', { entry: null }), error)
	);
</script>

{#if Component}<Component {...props}>{@render children?.()}</Component>{/if}
