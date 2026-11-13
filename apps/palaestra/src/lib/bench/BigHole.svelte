<script lang="ts">
	import type { Snippet } from 'svelte';
	import CardCounter from '../Counter.svelte' with { wake: 'load' };

	// A large deferred hole, like a CMS page's below-the-fold block: deep nested markup, an inline
	// `style` attribute on most elements, a few inline scripts and an island every 25 cards. About
	// 2 KB of HTML per card.
	let { cards = 125, tag = 'hole' }: { cards?: number; tag?: string; ogygiaFallback?: Snippet } =
		$props();
	const rows = Array.from({ length: cards }, (_, c) => c);
	const items = Array.from({ length: 10 }, (_, i) => i);
	const script_for = (t: string) =>
		`<script>window.__big_hole_${t} = (window.__big_hole_${t} || 0) + 1${'<'}/script>`;
</script>

<div data-big-hole={tag} style="display: grid; gap: 4px">
	{#each rows as c (c)}
		<div style="padding: 2px">
			<div style="margin: 1px">
				<article style="border: 1px solid #ccc; padding: 4px">
					<header style="font-weight: 600"><h3 style="margin: 0">{tag} card {c}</h3></header>
					<ul style="list-style: none; margin: 0; padding: 0">
						{#each items as i (i)}
							<li style="display: inline-block; margin: 0 4px 0 0">
								<a href="/bench-cms/holes/{tag}/{c}/{i}" style="color: #036; text-decoration: none"
									><span>{tag} link {c}.{i}</span></a
								>
							</li>
						{/each}
					</ul>
					{#if c % 25 === 0}
						{@html script_for(tag)}
						<CardCounter label="{tag} island {c}" />
					{/if}
				</article>
			</div>
		</div>
	{/each}
</div>
