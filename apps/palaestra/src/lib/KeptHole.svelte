<script lang="ts">
	// A server island whose answer brings its own linked sheet (over the inline threshold), on two
	// pages with the same props: a navigation from one to the other keeps the answered hole as it is
	// (e2e/hole-kept-sheet.spec.ts).
	import type { Snippet } from 'svelte';
	let { ogygiaFallback }: { ogygiaFallback?: Snippet } = $props();
</script>

<section class="kept-hole" data-kept-hole>
	<h2 class="kept-hole-title">kept hole</h2>
	<p class="kept-hole-body">the same answer on both pages</p>
</section>

<style>
	.kept-hole {
		word-spacing: 6px;
		outline: 2px dashed rgb(17, 85, 51);
		padding: 0.75rem 1rem;
		margin: 1rem 0;
		border-radius: 0.5rem;
		background: rgb(240, 248, 244);
	}
	.kept-hole-title {
		letter-spacing: 2px;
		font-size: 1.125rem;
		margin: 0 0 0.25rem;
		color: rgb(17, 85, 51);
	}
	.kept-hole-body {
		margin: 0;
		line-height: 1.5;
		color: rgb(34, 51, 68);
		font-style: italic;
	}
</style>
