<script lang="ts">
	// an island that reads the outer query in the browser and shows its region
	import { Region } from 'ogygia';
	import { heldOuter } from './outer.remote';
	const value = heldOuter();
</script>

<div data-hih-outer-host>
	{#if value.current}
		<Region of={value.current} />
	{:else if value.error}
		<span data-hih-error>failed</span>
	{:else}
		<span data-hih-pending>connecting…</span>
	{/if}
</div>
