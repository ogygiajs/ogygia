<script lang="ts">
	// The drop-in setContext on a csr=true page: Kit hydrates the page, but the island inside the
	// lake is ogygia's, a separate hydration root that reads this context through the page marker.
	import { setContext } from 'ogygia';
	import SetCtxLakeHost from '$lib/lakes/SetCtxLakeHost.svelte';

	setContext('boot', { theme: 'harbour', user: 'grace' });
	setContext('appName', 'playground-kit');
	// Host-only: the page reads it, no island does, so it stays out of the marker.
	setContext('hostOnly', { note: 'never shipped to islands' }, { islands: false });

	let n = $state(0);
</script>

<h1 data-page>Drop-in setContext on a csr=true page</h1>
<button data-kit-btn onclick={() => n++}>kit:{n}</button>

<div style="height: 150vh"></div>
<SetCtxLakeHost />
