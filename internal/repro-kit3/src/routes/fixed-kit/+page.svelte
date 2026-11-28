<script>
	// Kit's own prerendered page, the one the csr=false page must agree with.
	import { PUBLIC_REGION_NAME } from '$app/env/public';
	let shown = $state('');
</script>

<h1 data-page="fixed-kit">a prerendered Kit page</h1>
<button data-env-kit onclick={() => (shown = `read: ${PUBLIC_REGION_NAME}`)}>show the env</button>
<p data-env-kit-value>{shown}</p>
