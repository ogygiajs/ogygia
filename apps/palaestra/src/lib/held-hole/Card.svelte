<script lang="ts">
	// A held region's component that wakes (its remote imports it `with { wake: 'load' }`), with a
	// server island inside it.
	import Greeting from '$lib/Greeting.svelte' with { render: 'deferred' };
	let { label = '' }: { label?: string } = $props();
	let count = $state(0);
</script>

<div data-held-card>
	<button data-held-card-btn onclick={() => (count += 1)}>{label}: {count}</button>
	<Greeting salutation="Held" />
</div>
