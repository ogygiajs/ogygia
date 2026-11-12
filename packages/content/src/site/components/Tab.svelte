<!--
@component
One panel of a TabGroup. Its `label` names the tab: it rides `data-label`, where TabGroup's island
reads it to build the tab bar.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<div class="og-tabs-panel" role="tabpanel" data-label={label} aria-label={label}>
	{@render children()}
</div>
