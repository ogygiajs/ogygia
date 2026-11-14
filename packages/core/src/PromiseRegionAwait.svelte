<script lang="ts">
	import Region from './Region.svelte';
	import { untrack, type Snippet } from 'svelte';
	import { register_late_region } from './late-region-registry.ts';
	import type { RegionValue } from './region.ts';
	import { wire_form } from './transport.ts';

	interface Props {
		of: Promise<RegionValue>;
		placeholder?: Snippet;
		children?: Snippet;
	}

	let { of, placeholder, children }: Props = $props();

	const late_slot = typeof window === 'undefined' ? untrack(() => register_late_region(of)) : null;
</script>

{#if late_slot}<og-late-slot data-og-slot={late_slot} style="display:contents"
		>{@render placeholder?.()}</og-late-slot
	>{:else}<Region of={wire_form(await of)} {placeholder} {children} __baked />{/if}
