<script>
	// A page whose only region wakes on interaction and imports $app/env/public: a hover loads its
	// module ahead of the replay code, so Kit's env module runs before any of the runtime's lazy code.
	import EnvOnClick from '#lib/EnvOnClick.svelte' with { wake: 'interaction' };
</script>

<h1 data-page="env">the env page</h1>
<EnvOnClick />
