<script lang="ts">
	// THE ROUTER'S HISTORY (e2e/router-history.spec.ts): back, forward and the address bar behave as
	// on a plain site. A tall page to scroll (/router-history/b) and a page of app-managed fragments
	// (/router-history/fragments: links whose hash names no element).
</script>

<svelte:head>
	<title>router history A</title>
</svelte:head>

<h1 data-history-a>Router history A</h1>
<p><a href="/router-history/b" data-to-b>to B</a></p>
<p><a href="/router-history/fragments" data-to-fragments>to the fragments page</a></p>
<p><a href="/router-history/late" data-to-late>to the page with a late-sized top</a></p>
