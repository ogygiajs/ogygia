<script lang="ts">
	// A region at the top of a page that gets its height only once it is live (e2e/router-history:
	// #452): the server renders it empty, and it lays out 109 px of content after it wakes.
	let live = $state(false);
	$effect(() => {
		live = true;
	});
</script>

<div data-late-top style="height: {live ? 109 : 0}px; overflow: hidden">late header</div>
