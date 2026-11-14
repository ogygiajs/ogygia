<script lang="ts">
	import { setNested } from './nested.ts';
	import type { Snippet } from 'svelte';

	let { children }: { children?: Snippet } = $props();

	setNested(false);
</script>

{@render children?.()}
