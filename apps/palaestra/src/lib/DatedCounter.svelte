<script lang="ts">
	// A counter whose props need devalue (a Date does not cross as JSON): its props script is in
	// devalue's lane, so its wake loads devalue (e2e/lazy-chunk-retry.spec.ts).
	let { since, label }: { since: Date; label: string } = $props();
	let count = $state(0);
</script>

<div class="island" data-dated-counter={label} data-since-ok={since instanceof Date}>
	<strong>{label}</strong>:
	<button onclick={() => (count += 1)}>count is {count}</button>
	<span data-since>{since.toISOString()}</span>
</div>
