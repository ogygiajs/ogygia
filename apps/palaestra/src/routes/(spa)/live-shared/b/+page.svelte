<script lang="ts">
	import Holder from '$lib/live-shared/Holder.svelte' with { wake: 'load', keep: 'live-holder' };
</script>

<h1 data-static-shell>live shared: page B</h1>
<p><a href="/live-shared" data-to-a>to page A</a></p>

<Holder />
