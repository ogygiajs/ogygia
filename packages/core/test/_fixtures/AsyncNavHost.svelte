<!-- An async-mode page switch around LateIslandAwait: `go()` swaps the old page for a new one holding an island whose code loads late. -->
<script>
	import LateIslandAwait from '../../src/LateIslandAwait.svelte';
	/** @type {{ load: () => Promise<import('svelte').Component> }} */
	let { load } = $props();
	let page = $state('old');
	export function go() {
		page = 'new';
	}
</script>

<svelte:boundary>
	{#if page === 'old'}<p data-old>old page</p>{:else}<p data-new>new page</p>
		<LateIslandAwait {load} props={{}} />{/if}
	{#snippet pending()}<p data-pending>pending</p>{/snippet}
</svelte:boundary>
