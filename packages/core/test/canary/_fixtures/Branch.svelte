<script lang="ts">
	let { on }: { on: boolean } = $props();
</script>

{#if on}<b>yes</b>{:else}<i>no</i>{/if}
