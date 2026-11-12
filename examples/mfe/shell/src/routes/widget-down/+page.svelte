<script lang="ts">
	import { Region } from 'ogygia';
	import type { RegionValue } from 'ogygia';
	let { data }: { data: { retired: RegionValue; kpis: RegionValue } } = $props();
</script>

<main>
	<h1>A widget whose team is down</h1>
	<div data-testid="retired-dash"><Region of={data.retired} /></div>
	<p data-testid="still-here">The rest of the page renders.</p>
	<div data-testid="static-dash"><Region of={data.kpis} /></div>
</main>
