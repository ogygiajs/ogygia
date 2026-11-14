<!-- The region grid's snippets that hold a region of their own: an island in a region's children, a
fallback or a placeholder. -->
<script module lang="ts">
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
	export { island_in, hole_in };
</script>

{#snippet hole_in()}<Region
		__mode="server"
		__entry="hole-in"
		__component={Tiny}
		__props={{ inner: 2 }}
		__defer="load"
	/>{/snippet}

{#snippet island_in()}<Region
		__mode="island"
		__entry="/islands/inner.js"
		__component={Tiny}
		__props={{ inner: 1 }}
		idle
	/>{/snippet}
