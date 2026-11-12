<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		start = 0,
		label = 'Counter'
	}: { start?: number; label?: string; ogygiaFallback?: Snippet } = $props();
	// svelte-ignore state_referenced_locally
	let count = $state(start);
</script>

<!-- (`data-build`: which build rendered it, set only when the simulator builds the app twice for a
     deploy, internal/sim/src/builds.ts; absent in every other build) -->
<div class="island" data-counter data-build={import.meta.env.VITE_SIM_BUILD}>
	<strong>{label}</strong>:
	<button onclick={() => (count += 1)}>count is {count}</button>
</div>
