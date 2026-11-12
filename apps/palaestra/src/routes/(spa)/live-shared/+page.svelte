<script lang="ts">
	// e2e/live-query-late-reader.spec.ts: Leaver makes the live clock's entry; Holder (kept across
	// navigations) reads it only from a child it mounts later. /live-shared/b has Holder alone.
	import Leaver from '$lib/live-shared/Leaver.svelte' with { wake: 'load' };
	import Holder from '$lib/live-shared/Holder.svelte' with { wake: 'load', keep: 'live-holder' };
</script>

<h1 data-static-shell>live shared: page A</h1>
<p><a href="/live-shared/b" data-to-b>to page B</a></p>

<Leaver />
<Holder />
