<script lang="ts">
	// LAZY CHUNKS THAT FAIL (e2e/lazy-chunk-retry.spec.ts): the runtime's lazy pieces (the hydrate
	// core, devalue, the interaction replay) each load once, on the first island that needs them. A
	// load that fails must not break every later wake in the tab. Three islands, three moments: one
	// woken by a click, one at load (its props need devalue), one far below the fold (a later wake,
	// after a failed first one).
	import InteractionCounter from '$lib/InteractionCounter.svelte' with { wake: 'interaction' };
	import DatedCounter from '$lib/DatedCounter.svelte' with { wake: 'visible' };

	const since = new Date('2026-01-02T03:04:05.000Z');
</script>

<h1 data-static-shell>Lazy chunks that fail</h1>

<InteractionCounter />

<DatedCounter {since} label="near" />

<div style="height: 3000px" data-spacer></div>

<DatedCounter {since} label="far" />
