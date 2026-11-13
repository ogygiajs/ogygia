<script lang="ts">
	let { tag }: { tag: string } = $props();
	let n = $state(0);
</script>

<div data-ctr-lake={tag}><button data-ctr-lake-btn={tag} onclick={() => n++}>lake:{n}</button></div>
