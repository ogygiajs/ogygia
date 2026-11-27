<script>
	import { PUBLIC_GREETING } from '$app/env/public';
	let n = $state(0);
</script>

<button data-counter onclick={() => n++}>count {n}</button>
<p data-public-env>{PUBLIC_GREETING}</p>
