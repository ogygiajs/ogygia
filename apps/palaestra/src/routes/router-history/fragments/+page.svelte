<svelte:head>
	<title>router history fragments</title>
</svelte:head>

<!-- App-managed fragments: no element has the id a link's hash names (an app opens a row keyed by
     the hash), so the router takes the click over instead of the browser's jump to the top. -->
<h1 data-history-fragments>Router history fragments</h1>
<div style="height: 1000px"></div>
<p><a href="#row-1" data-row-1>row 1</a> <a href="#row-2" data-row-2>row 2</a></p>
<div style="height: 4000px"></div>
