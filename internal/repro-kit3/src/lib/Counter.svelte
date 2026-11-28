<script>
	import { PUBLIC_GREETING, PUBLIC_REGION_NAME } from '$app/env/public';
	let n = $state(0);
</script>

<button data-counter onclick={() => n++}>count {n}</button>
<p data-public-env>{PUBLIC_GREETING}</p>
<p data-public-dynamic-env>{PUBLIC_REGION_NAME}</p>
