<script lang="ts">
	// the outer held region's component, an island: it renders another island
	import Middle from './Middle.svelte' with { wake: 'load' };
	let { label }: { label: string } = $props();
</script>

<article data-hih-outer>{label} <Middle label="middle island" /></article>
