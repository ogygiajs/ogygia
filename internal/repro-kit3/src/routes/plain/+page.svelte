<script>
	// A page whose only region never imports $app/env/public: it carries no env, and its links go to
	// /env and to the prerendered /fixed (whose hover warms that page's regions) by the router.
	import Hello from '#lib/Hello.svelte' with { wake: 'load' };
</script>

<h1 data-page="plain">a page with no env</h1>
<Hello />
<a href="/env" data-to-env>to the env page</a>
<a href="/fixed" data-to-fixed data-sveltekit-preload-data="hover">to the prerendered env page</a>
