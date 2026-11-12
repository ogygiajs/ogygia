<script lang="ts">
	// an island inside the outer region's island: it renders the inner region's host
	import InnerHost from './InnerHost.svelte';
	let { label }: { label: string } = $props();
</script>

<section data-hih-middle>{label} <InnerHost /></section>
