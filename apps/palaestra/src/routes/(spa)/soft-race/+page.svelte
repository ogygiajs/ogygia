<script lang="ts">
	// WORK IN FLIGHT BELONGS TO THE PAGE THAT STARTED IT (e2e/router-ownership.spec.ts): a soft refresh
	// started here must not land on the page the visitor moved to, and a prefetch started before a
	// mutation must not fill the cache with the page as it was.
	// A cancelled navigation must not end the one already in flight (a guard runs before any claim).
	import SoftRefreshButton from '$lib/SoftRefreshButton.svelte' with { wake: 'load' };
	import BlockedLinkGuard from '$lib/BlockedLinkGuard.svelte' with { wake: 'load' };
</script>

<svelte:head>
	<title>soft race A</title>
	<meta name="soft-race" content="a" />
</svelte:head>

<h1 data-soft-heading>Soft race A</h1>

<SoftRefreshButton />

<BlockedLinkGuard />

<p><a href="/soft-race/b" data-soft-b data-sveltekit-preload-data="hover">to B</a></p>
<p><a href="/soft-race/blocked" data-soft-blocked>to a page a guard blocks</a></p>
