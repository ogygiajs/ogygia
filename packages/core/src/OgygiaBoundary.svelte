<!--
@component
Optional public annotation wrapper around a region usage.

Renders `children` only: no extra DOM, no nested-island context, and no `hydrate` / `render`
attributes. Use it to mark an island in source for humans. It is **not** `<svelte:boundary>`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
