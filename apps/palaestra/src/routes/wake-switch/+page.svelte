<script lang="ts">
	// AN EARLY CLICK ON A `visible` ISLAND (e2e/wake-early-click.spec.ts): the switch is in view at
	// load, so its own schedule wakes it; a click that lands before it is live is replayed once, when
	// it is, and nothing is left queued for the next click.
	import WakeSwitch from '$lib/WakeSwitch.svelte' with { wake: 'visible' };
</script>

<h1 data-static-shell>An early click on a visible island</h1>

<WakeSwitch />
