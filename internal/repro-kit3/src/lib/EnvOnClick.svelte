<script>
	import { PUBLIC_REGION_NAME } from '$app/env/public';
	// shown only after the click: the value the browser's module read, not the server's HTML
	let shown = $state('');
</script>

<button data-env-click onclick={() => (shown = `read: ${PUBLIC_REGION_NAME}`)}>show the env</button>
<p data-env-click-value>{shown}</p>
