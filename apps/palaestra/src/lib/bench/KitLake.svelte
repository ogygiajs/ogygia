<script lang="ts">
	// Site chrome as a lake on a csr=true page (/bench-cms/kit): islands on idle, load and visible,
	// two deferred holes, and web components that render into their own light DOM.
	import IdleCounter from '../Counter.svelte' with { wake: 'idle' };
	import LoadCounter from '../Counter.svelte' with { wake: 'load' };
	import VisibleCounter from '../Counter.svelte' with { wake: 'visible' };
	import Hole from './BigHole.svelte' with { render: 'deferred' };
	let {
		tag,
		idle = 2,
		load = 1,
		visible = 0
	}: { tag: string; idle?: number; load?: number; visible?: number } = $props();
	const widgets = Array.from({ length: 40 }, (_, i) => i);
</script>

<div data-kit-lake={tag}>
	<nav>
		{#each widgets as i (i)}
			<x-widget data-in-lake={tag}><a href="/bench-cms/kit/{tag}/{i}">{tag} item {i}</a></x-widget>
		{/each}
	</nav>
	{#each Array.from({ length: idle }, (_, i) => i) as i (i)}
		<IdleCounter label="{tag} idle {i}" />
	{/each}
	{#each Array.from({ length: load }, (_, i) => i) as i (i)}
		<LoadCounter label="{tag} load {i}" />
	{/each}
	{#each Array.from({ length: visible }, (_, i) => i) as i (i)}
		<div style="margin-top: 200vh"><VisibleCounter label="{tag} visible {i}" /></div>
	{/each}
	<Hole cards={4} tag="{tag}-hole-a">
		{#snippet ogygiaFallback()}<p>loading…</p>{/snippet}
	</Hole>
	<Hole cards={4} tag="{tag}-hole-b">
		{#snippet ogygiaFallback()}<p>loading…</p>{/snippet}
	</Hole>
</div>
