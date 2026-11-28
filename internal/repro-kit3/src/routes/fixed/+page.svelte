<script>
	// A prerendered csr=false page: its HTML is the build's, its dynamic public env the server's. One
	// region loads at once and reads the env as its module runs, the other wakes on interaction.
	import EnvOnLoad from '#lib/EnvOnLoad.svelte' with { wake: 'load' };
	import EnvOnClick from '#lib/EnvOnClick.svelte' with { wake: 'interaction' };
</script>

<h1 data-page="fixed">a prerendered page</h1>
<EnvOnLoad />
<EnvOnClick />
