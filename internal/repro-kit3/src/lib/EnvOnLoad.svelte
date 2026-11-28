<script module>
	import { PUBLIC_REGION_NAME } from '$app/env/public';
	// read as the module first runs, not as the region renders
	const at_top = `top: ${PUBLIC_REGION_NAME}`;
</script>

<script>
	let shown = $state('');
</script>

<button data-env-load onclick={() => (shown = `${at_top}, read: ${PUBLIC_REGION_NAME}`)}>
	show the env
</button>
<p data-env-load-value>{shown}</p>
