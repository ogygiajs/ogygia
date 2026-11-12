<script lang="ts">
	// A held region that wakes, with a server island inside its component (internal/sim
	// test/found/held-region-hole.test.ts).
	import Host from '$lib/held-hole/Host.svelte' with { wake: 'load' };
</script>

<h1 data-static-shell>A held region with a server island in it</h1>
<Host />
