<script lang="ts">
	/**
	 * A `<Region of={promise}>` (Region.svelte hands the promise here): the region owns the whole wait.
	 * This one works anywhere — the server cannot wait without Svelte's async mode, so it renders the
	 * placeholder and the browser resolves the promise after hydration (where the app runs async mode,
	 * PromiseRegionAwait.svelte awaits it in the render instead: vite/late-island.ts).
	 *
	 * LATE SLOT: inside a document that delivers late chunks (the server router's streamed document
	 * opens that scope), the placeholder is wrapped in an `og-late-slot` the response fills when the
	 * promise settles. Nowhere else: a slot nothing fills stays empty forever.
	 *
	 * LAG, don't clear: a NEW promise (a re-search) keeps the previous value on screen until it lands,
	 * so the old content morphs instead of flashing through empty.
	 */
	import { flushSync, type Snippet } from 'svelte';
	import Region from './Region.svelte';
	import { register_late_region } from './late-region-registry.ts';
	import type { RegionValue } from './region.ts';

	interface Props {
		of: Promise<RegionValue>;
		placeholder?: Snippet;
		children?: Snippet;
	}

	let { of, placeholder, children }: Props = $props();

	// svelte-ignore state_referenced_locally
	const late_slot = typeof window === 'undefined' ? register_late_region(of) : null;
	let settled: { value?: RegionValue; failed?: { error: unknown } } = $state.raw({});
	$effect(() => {
		const p = of;
		let live = true;
		Promise.resolve(p).then(
			(value) => {
				if (live) settled = { value };
			},
			(error) => {
				if (!live) return;
				settled = { failed: { error } };
				// @why Svelte rethrows an effect's error out of flushSync when no boundary holds it, so it rejects this promise as async mode's await does (test: test/browser/_held-promise-fails.ts › a held region whose promise rejects with no boundary: the page gets its own error as an unhandled rejection, once)
				flushSync();
			}
		);
		return () => {
			live = false;
		};
	});
	$effect(() => {
		if (settled.failed) throw settled.failed.error;
	});
</script>

{#if settled.value}<Region
		of={settled.value}
		{placeholder}
		{children}
	/>{:else if late_slot}<og-late-slot data-og-slot={late_slot} style="display:contents"
		>{@render placeholder?.()}</og-late-slot
	>{:else}{@render placeholder?.()}{/if}
