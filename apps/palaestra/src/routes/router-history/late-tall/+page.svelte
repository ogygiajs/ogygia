<script lang="ts">
	// THE ROUTER'S HISTORY (e2e/router-history.spec.ts, #452): a page that is short until its region
	// wakes, so a Back or Forward that puts the scroll back at the swap is clamped to the short page.
	import LateTall from '$lib/LateTall.svelte' with { wake: 'load' };
</script>

<svelte:head>
	<title>router history late tall</title>
</svelte:head>

<h1 data-history-late-tall>Router history, a page that gets tall late</h1>
<p><a href="/router-history" data-late-tall-to-a>to A</a></p>
<!-- (some height of its own: the put-back moves the page, to the short page's bottom) -->
<div style="height: 1000px"></div>
<LateTall />
