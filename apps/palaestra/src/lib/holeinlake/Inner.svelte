<script lang="ts">
	// the innermost server island: no fallback, and its server render takes a while
	await new Promise((r) => setTimeout(r, 400));
</script>

<p data-hil-inner>inner hole</p>
