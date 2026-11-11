<script lang="ts">
	// A region that makes its page tall only once it is live (e2e/router-history: #452): the server
	// renders it empty, so at the swap the page is too short to reach a saved scroll position.
	let live = $state(false);
	$effect(() => {
		live = true;
	});
</script>

<div data-late-tall style="height: {live ? 6000 : 0}px">late body</div>
