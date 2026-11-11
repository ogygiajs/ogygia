<script lang="ts">
	// THE ROUTER'S HISTORY (e2e/router-history.spec.ts, #452): a tall page whose top region gets its
	// height only after it wakes, so a Back or Forward that puts the scroll back before it has laid out
	// lands short of where the page was left.
	import LateTop from '$lib/LateTop.svelte' with { wake: 'load' };
</script>

<svelte:head>
	<title>router history late</title>
</svelte:head>

<LateTop />
<h1 data-history-late>Router history, a late-sized top</h1>
<p><a href="/router-history" data-late-to-a>to A</a></p>
<div style="height: 6000px"></div>
