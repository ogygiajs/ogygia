<!-- The region grid's snippets that hold a region of their own: an island in a region's children, a
fallback or a placeholder. -->
<script module lang="ts">
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
	export { island_in, hole_in };
</script>

{#snippet hole_in()}<Region
		__og={{ mode: 'server', entry: 'hole-in', component: Tiny, when: 'load' }}
		__props={{ inner: 2 }}
	/>{/snippet}

{#snippet island_in()}<Region
		__og={{ mode: 'island', entry: '/islands/inner.js', component: Tiny, wake: 'idle' }}
		__props={{ inner: 1 }}
	/>{/snippet}
