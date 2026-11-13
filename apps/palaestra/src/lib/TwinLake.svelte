<script lang="ts">
	import LoadCounter from './Counter.svelte' with { wake: 'load' };
	import VisibleCounter from './Counter.svelte' with { wake: 'visible' };
	let { tag, visible = false }: { tag: string; visible?: boolean } = $props();
</script>

<div data-twin-lake={tag}>
	<p data-twin-text>{tag} chrome</p>
	<LoadCounter label="{tag} load" />
	{#if visible}
		<div style="margin-top: 150vh"><VisibleCounter label="{tag} visible" /></div>
	{/if}
</div>
