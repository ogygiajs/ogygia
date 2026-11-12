<script lang="ts">
	import { Region } from 'ogygia';
	import type { RegionValue } from 'ogygia';
	import ShellLater from '$lib/ShellLater.svelte' with { render: 'deferred' };
	let { data }: { data: { acme: RegionValue; globex: RegionValue } } = $props();
</script>

<main>
	<h1>Two deferred dash widgets</h1>
	<ShellLater who="shell" />
	<div data-testid="widget-acme"><Region of={data.acme} /></div>
	<div data-testid="widget-globex"><Region of={data.globex} /></div>
</main>
