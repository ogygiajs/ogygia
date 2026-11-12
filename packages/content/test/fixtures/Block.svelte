<script lang="ts">
	// A stand-in block: names itself and wraps whatever renders inside it.
	import type { Snippet } from 'svelte';

	let { name, title, children }: { name: string; title?: string; children?: Snippet } = $props();
</script>

<section data-block={name}>{title ?? ''}{@render children?.()}</section>
