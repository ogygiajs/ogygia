<script lang="ts">
	let { items }: { items: string[] } = $props();
</script>

{#each items as item (item)}<b>{item}</b>{:else}<i>none</i>{/each}
