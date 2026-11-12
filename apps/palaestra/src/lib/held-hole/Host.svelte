<script lang="ts">
	// An island host for a held region (csr=false: the binding lives in a woken island).
	import { Region } from 'ogygia';
	import { card } from './card.remote';

	const value = card();
</script>

<div data-held-host>
	{#if value.current}
		<Region of={value.current} />
	{:else}
		<span data-held-pending>connecting…</span>
	{/if}
</div>
