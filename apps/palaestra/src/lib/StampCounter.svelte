<script lang="ts">
	// A counter whose props carry a transportable class it imports only as a type: its wake loads
	// the class's module first (e2e/lazy-chunk-retry.spec.ts).
	import type { RetryStamp } from './retry-stamp.svelte.ts';

	let { stamp, label }: { stamp: RetryStamp; label: string } = $props();
	let count = $state(0);
</script>

<div class="island" data-stamp-counter={label}>
	<strong>{label}</strong>:
	<button onclick={() => (count += 1)}>count is {count}</button>
	<span data-stamp>{stamp.stamp_text()}</span>
</div>
