<script lang="ts">
	// A shared component placing the lake (a route file on an all-csr=true route would compile its
	// own regions away; a component keeps them and degrades per document, like a CMS block does).
	import SetCtxLake from './SetCtxLake.svelte' with { wake: 'none' };
</script>

<SetCtxLake />
