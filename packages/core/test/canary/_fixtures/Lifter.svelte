<script lang="ts">
	import type { Snippet } from 'svelte';
	import { reduce_region_snippet } from '../../../src/region-snippet.ts';
	import { region } from '../../../src/region.ts';
	let { snippet, out }: { snippet: Snippet; out: { frozen?: unknown } } = $props();
	out.frozen = reduce_region_snippet(region.snippet(snippet));
</script>
