<script>
	let { status, error, data } = $props();
</script>

<p data-oops>{status} {error.message} {JSON.stringify(data)}</p>
