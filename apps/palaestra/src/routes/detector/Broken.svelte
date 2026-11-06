<script lang="ts">
	let { label }: { label: string } = $props();
	let n = $state(0);
</script>

<!-- the `{#each}` puts `<!--[-->` anchors INSIDE the island's markup: stripping them breaks Svelte's
     walk (the island's own outer pair alone is one the runtime puts back) -->
<div data-testid="broken-root">
	{#each [label] as text (text)}<p>{text}</p>{/each}
	<button data-testid="broken-btn" onclick={() => n++}>clicked {n}</button>
</div>
