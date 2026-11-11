<script lang="ts">
	// A Releases page: the package list beside, the filters on top, a card per version. Server HTML:
	// every filter is a link the server reads, and every card is a <details> that starts open. The one
	// island adds expand and collapse all, and folds the older cards on its first run.
	import { page } from '$app/state';
	import PageHead from '$lib/PageHead.svelte';
	import ExpandAll from './ExpandAll.svelte' with { wake: 'load' };
	import { href_with, type Filters, type PackageLink, type VersionCard } from './view';
	import type { Kind } from './changelog';

	let {
		title,
		current,
		packages,
		filters,
		cards
	}: {
		title: string;
		current: string | null;
		packages: PackageLink[];
		filters: Filters;
		cards: VersionCard[];
	} = $props();

	const types: Array<[Kind | null, string]> = [
		[null, 'All'],
		['major', 'Major'],
		['minor', 'Minor'],
		['patch', 'Patch']
	];
	const url = $derived(page.url);
</script>

<PageHead {title} description="Every release of every ogygia package, newest first." />

<div class="releases shell">
	<nav class="packages" aria-label="Packages">
		<a href="/releases" aria-current={current === null ? 'page' : undefined}>All packages</a>
		{#each packages as p (p.id)}
			<a href="/releases/{p.id}" aria-current={current === p.id ? 'page' : undefined}>
				{p.name} <span class="count">{p.count}</span>
			</a>
		{/each}
	</nav>

	<main>
		<h1>{title}</h1>
		<div class="filters">
			<span role="group" aria-label="Release type">
				{#each types as [type, label] (label)}
					<a
						href={href_with(url, { type })}
						aria-current={filters.type === type ? 'true' : undefined}>{label}</a
					>
				{/each}
			</span>
			<a
				href={href_with(url, { pre: !filters.pre })}
				aria-current={filters.pre ? 'true' : undefined}
			>
				{filters.pre ? 'Hide pre-releases' : 'Show pre-releases'}
			</a>
			<ExpandAll />
		</div>

		{#if cards.length === 0}
			<p>No releases match.</p>
		{/if}
		{#each cards as card (card.version)}
			<details class="card" open data-release-version={card.version}>
				<summary>
					<span class="version">{card.version}</span>
					<span class="kind {card.kind}">{card.kind}</span>
					{#if card.prerelease}<span class="kind pre">pre-release</span>{/if}
					{#if card.date}<time datetime={card.date}>{card.date}</time>{/if}
				</summary>
				{#each card.releases as r (r.package)}
					<section>
						<h2 data-release-package>{r.package}</h2>
						{#each r.groups as g (g.title)}
							<h3>{g.title}</h3>
							<ul>
								{#each g.lines as line, i (i)}
									<li>{@html line.html}</li>
								{/each}
							</ul>
						{/each}
						{#if r.deps.length}
							<p class="deps">Updated dependencies: {r.deps.join(', ')}</p>
						{/if}
					</section>
				{/each}
			</details>
		{/each}
	</main>
</div>

<style>
	.releases {
		display: grid;
		grid-template-columns: 14rem minmax(0, 1fr);
		gap: 2.5rem;
		padding-top: 2.5rem;
		padding-bottom: 4rem;
	}
	@media (max-width: 52rem) {
		.releases {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.packages {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		position: sticky;
		top: 4.5rem;
		align-self: start;
	}
	.packages a[aria-current='page'],
	.filters a[aria-current='true'] {
		font-weight: 600;
	}
	.count {
		opacity: 0.6;
		font-size: 0.8em;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.filters [role='group'] {
		display: inline-flex;
		gap: 0.75rem;
	}
	.card {
		border: 1px solid var(--border, rgb(127 127 127 / 0.25));
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	summary {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		cursor: pointer;
	}
	.version {
		font-size: 1.25rem;
		font-weight: 600;
	}
	.kind {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.75;
	}
	time {
		margin-left: auto;
		opacity: 0.7;
		font-size: 0.875rem;
	}
	h2 {
		font-size: 1rem;
		margin: 1rem 0 0.25rem;
	}
	h3 {
		font-size: 0.85rem;
		margin: 0.5rem 0 0.25rem;
		opacity: 0.8;
	}
	.deps {
		font-size: 0.85rem;
		opacity: 0.7;
	}
</style>
