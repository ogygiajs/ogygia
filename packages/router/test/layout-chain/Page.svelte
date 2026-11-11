<script>
	let { title, ogygiaFallback } = $props();
</script>

<p class="page">{title}</p>
{@render ogygiaFallback?.()}
