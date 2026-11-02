<script lang="ts">
	// The same drop-in setContext on a csr=true page with no island ogygia wakes: Kit hydrates
	// everything, so the page ships no context marker.
	import { setContext } from 'ogygia';

	setContext('boot', { theme: 'harbour', user: 'grace' });
</script>

<h1 data-page>Drop-in setContext on a Kit-only page</h1>
