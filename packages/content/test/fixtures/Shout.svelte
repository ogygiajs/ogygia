<script lang="ts">
	// A stand-in element override: marks what it renders so a test can tell it was used.
	import type { Snippet } from 'svelte';

	let { children, ...rest }: { children?: Snippet } & Record<string, unknown> = $props();
</script>

<strong data-shout {...rest}>{@render children?.()}</strong>
