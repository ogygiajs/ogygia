<script lang="ts">
	// Plain-value context: `theme` holds a string with a default of 'light'. A reader under a
	// provider sees the provided value (a snapshot, not a live object); a reader with no provider
	// above it falls back to the default.
	import { readTheme } from '$lib/room-context.svelte.js';

	let { label = 'theme' }: { label?: string } = $props();
	const theme = readTheme();
</script>

<span class="island" data-ctx-theme={label}>{theme}</span>
