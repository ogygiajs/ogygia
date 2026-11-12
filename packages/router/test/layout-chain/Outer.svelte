<script>
	let { data, children } = $props();
</script>

<div class="outer" data-user={data.user}>{@render children()}</div>
