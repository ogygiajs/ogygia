<script lang="ts">
	// A lake holding an island that reads the page's drop-in setContext: on a csr=true page Kit
	// hydrates everything but this, so the island inside is ogygia's to wake — and its context can
	// only come from the page marker.
	import SetCtxReader from '#lib/SetCtxReader.svelte' with { wake: 'visible' };
</script>

<section data-setctx-lake>
	<p>A lake on a Kit-hydrated page. The island below reads the page's context.</p>
	<SetCtxReader label="lake" />
</section>
