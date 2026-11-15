<script>
	// A Kit page shell for the hole-under-Kit browser test: a deferred HOLE (the wrapper the transform
	// emits for `with { render: 'deferred' }`) with its fallback. The test SSRs this on a csr=true
	// document (setup.ts), then hydrates it the way Kit does (`hydrate()` over the SSR DOM).
	import Region from '../../../src/Region.svelte';
	import Counter from './Counter.svelte';
</script>

{#snippet fallback()}<p data-hole-fallback>loading</p>{/snippet}

<div data-shell>
	<Region
		__og={{ mode: 'server', entry: 'hole-kit', component: Counter, when: 'load' }}
		__props={{ start: 1 }}
		ogygiaFallback={fallback}
	/>
</div>
