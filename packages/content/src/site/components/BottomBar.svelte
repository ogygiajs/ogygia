<!--
@component
The bottom bar: a nav (labelled `label`, "Site" by default) that holds `lead` (a brand) at its start
and `actions` (buttons such as search, theme, menu) at its end.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		lead,
		actions,
		label = 'Site'
	}: {
		lead?: Snippet;
		actions?: Snippet;
		label?: string;
	} = $props();
</script>

<nav class="og-bottombar" aria-label={label}>
	<div class="og-bottombar-lead">
		{#if lead}{@render lead()}{/if}
	</div>
	<div class="og-bottombar-actions">
		{#if actions}{@render actions()}{/if}
	</div>
</nav>
