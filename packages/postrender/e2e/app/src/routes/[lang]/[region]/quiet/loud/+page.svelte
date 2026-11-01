<script lang="ts">
	let { data } = $props();
</script>

<h1 data-testid="loud">loud (its own config.postrender = true wins), render {data.render}</h1>
