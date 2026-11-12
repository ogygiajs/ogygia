<script lang="ts">
	import { Region } from 'ogygia';
	import type { RegionValue } from 'ogygia';
	let { data }: { data: { baked: RegionValue; deferred: RegionValue } } = $props();
</script>

<main>
	<h1>A dash widget with a server island</h1>
	<Region of={data.baked} />
	<Region of={data.deferred} />
</main>
