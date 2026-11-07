<script lang="ts">
	// WORK IN FLIGHT BELONGS TO THE PAGE THAT STARTED IT (e2e/router-ownership.spec.ts): a soft refresh
	// started here must not land on the page the visitor moved to, and a prefetch started before a
	// mutation must not fill the cache with the page as it was.
	import SoftRefreshButton from '$lib/SoftRefreshButton.svelte' with { wake: 'load' };
</script>

<svelte:head>
	<title>soft race A</title>
	<meta name="soft-race" content="a" />
</svelte:head>

<h1 data-soft-heading>Soft race A</h1>

<SoftRefreshButton />

<p><a href="/soft-race/b" data-soft-b data-sveltekit-preload-data="hover">to B</a></p>
