<script lang="ts">
	// What a popover's portal is to the body: a component mounted into `<body>` that renders nothing
	// until it opens. Svelte leaves an anchor beside its (empty) block, and opening inserts there.
	let open = $state(false);

	export function show() {
		open = true;
	}
</script>

{#if open}<div data-testid="popover">open</div>{/if}
