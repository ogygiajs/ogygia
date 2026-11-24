<script lang="ts">
	// A Releases page: the package list beside, the filters on top, a timeline entry per version.
	// Server HTML: every filter is a link the server reads, and every entry is a <details> that starts
	// open. The one island adds expand and collapse all, and folds the older entries on its first run.
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
		['minor', 'Minor'],
		['patch', 'Patch']
	];
	const url = $derived(page.url);
	const id_of = $derived(new Map(packages.map((p) => [p.name, p.id])));
	const total = $derived(packages.reduce((n, p) => n + p.count, 0));

	const latest = $derived(cards.find((c) => !c.prerelease) ?? cards[0]);
	const bumped = (card: VersionCard) => card.releases.filter((r) => r.groups.length === 0);

	const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	function pretty(iso: string): string {
		const d = new Date(`${iso}T00:00:00`);
		return Number.isNaN(+d) ? iso : DAY.format(d);
	}
</script>

<PageHead {title} description="Every release of every ogygia package, newest first." />

<div class="releases">
	<nav class="packages" aria-label="Packages">
		<p class="nav-label">Packages</p>
		<a href="/releases" aria-current={current === null ? 'page' : undefined}>
			<span class="name">All packages</span>
			<span class="count">{total}</span>
		</a>
		{#each packages as p (p.id)}
			<a href="/releases/{p.id}" aria-current={current === p.id ? 'page' : undefined}>
				<span class="name">{p.name}</span>
				<span class="count">{p.count}</span>
			</a>
		{/each}
	</nav>

	<main>
		<header class="head">
			<p class="eyebrow">Changelog</p>
			<h1>{title}</h1>
			<p class="lede">
				{current === null
					? 'Every release of every ogygia package, newest first.'
					: `Every release of ${title}, newest first.`}
			</p>
			<dl class="stats">
				{#if latest}
					<div class="stat {latest.kind}">
						<dt>Latest</dt>
						<dd>{latest.version}</dd>
					</div>
				{/if}
				<div class="stat">
					<dt>Versions</dt>
					<dd>{cards.length}</dd>
				</div>
				{#if current === null}
					<div class="stat">
						<dt>Packages</dt>
						<dd>{packages.length}</dd>
					</div>
				{/if}
			</dl>
		</header>

		<div class="toolbar">
			<div class="segmented" role="group" aria-label="Release type">
				{#each types as [type, label] (label)}
					<a
						href={href_with(url, { type })}
						aria-current={filters.type === type ? 'true' : undefined}>{label}</a
					>
				{/each}
			</div>
			<ExpandAll />
		</div>

		{#if cards.length === 0}
			<p class="empty">No releases match these filters.</p>
		{/if}

		<ol class="timeline">
			{#each cards as card (card.version)}
				<li class="entry {card.kind}" id="v{card.version}">
					<details open data-release-version={card.version}>
						<summary>
							<span class="version">{card.version}</span>
							<span class="badge {card.kind}">{card.kind}</span>
							{#if card.prerelease}<span class="badge pre">pre-release</span>{/if}
							{#if card.date}<time class="date" datetime={card.date}>{pretty(card.date)}</time>{/if}
							<span class="chev" aria-hidden="true"></span>
						</summary>
						<div class="body">
							{#each card.releases.filter((r) => r.groups.length > 0) as r (r.package)}
								<section class="pkg">
									{#if current === null}
										<h2 data-release-package>
											{#if id_of.get(r.package)}
												<a href="/releases/{id_of.get(r.package)}">{r.package}</a>
											{:else}
												{r.package}
											{/if}
										</h2>
									{/if}
									{#each r.groups as g (g.title)}
										<h3>{g.title}</h3>
										<ul>
											{#each g.lines as line, i (i)}
												<li>
													<div class="text">{@html line.html}</div>
													{#if line.pr || line.commit || line.author}
														<div class="credits">
															{#if line.pr}<a href={line.pr.href}>{line.pr.label}</a>{/if}
															{#if line.commit}<a class="sha" href={line.commit.href}
																	>{line.commit.label}</a
																>{/if}
															{#if line.author}<span
																	>by <a href={line.author.href}>{line.author.label}</a></span
																>{/if}
														</div>
													{/if}
												</li>
											{/each}
										</ul>
									{/each}
									{#if r.deps.length}
										<p class="deps">Dependencies: {r.deps.join(', ')}</p>
									{/if}
								</section>
							{/each}
							{#if bumped(card).length}
								<p class="bumped">
									<span>Dependency updates only</span>
									{#each bumped(card) as r, i (r.package)}{#if i},
										{/if}<span data-release-package
											>{#if id_of.get(r.package) && current === null}<a
													href="/releases/{id_of.get(r.package)}">{r.package}</a
												>{:else}{r.package}{/if}</span
										>{/each}
								</p>
							{/if}
						</div>
					</details>
				</li>
			{/each}
		</ol>
	</main>

	<aside class="rail" aria-label="Versions">
		<p class="nav-label">Versions</p>
		<ol>
			{#each cards as card (card.version)}
				<li>
					<a href="#v{card.version}" class={card.kind}>
						<span class="rail-v">{card.version}</span>
						{#if card.date}<span class="rail-d">{card.date.slice(5).replace('-', '/')}</span>{/if}
					</a>
				</li>
			{/each}
		</ol>
	</aside>
</div>

<style>
	.releases {
		display: grid;
		grid-template-columns: 272px minmax(0, 1fr) 232px;
		min-height: calc(100vh - 57px);
	}
	main {
		width: 100%;
		max-width: 820px;
		margin-inline: auto;
		padding: clamp(2rem, 4vw, 3.5rem) clamp(1.5rem, 4vw, 3.5rem) 6rem;
	}

	/* Package list */
	.packages {
		display: flex;
		flex-direction: column;
		gap: 1px;
		position: sticky;
		top: 57px;
		align-self: start;
		height: calc(100vh - 57px);
		overflow-y: auto;
		padding: 2rem 1.125rem;
		border-right: 1px solid var(--line);
	}
	.nav-label {
		margin: 0 0 0.5rem;
		padding-inline: 0.625rem;
		font: 500 0.6875rem/1 var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.packages a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.4rem 0.625rem;
		border-radius: var(--r-sm);
		font: 400 0.875rem/1.3 var(--font-body);
		color: var(--text-dim);
		text-decoration: none;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}
	.packages a:hover {
		background: var(--bg-raised);
		color: var(--text);
	}
	.packages a[aria-current='page'] {
		background: var(--accent-deep);
		color: var(--accent);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		font: 400 0.75rem/1 var(--font-mono);
		color: var(--text-faint);
	}
	.packages a[aria-current='page'] .count {
		color: var(--accent);
	}

	/* Header */
	/* One colour per kind of release, used by its badge, version, cards and dots. */
	.releases {
		--patch: var(--accent);
		--minor: var(--accent);
		--major: var(--warn);
	}
	.patch {
		--kind: var(--patch);
	}
	.minor {
		--kind: var(--minor);
	}
	.major {
		--kind: var(--major);
	}

	.head {
		margin-bottom: 1.75rem;
	}
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 1.5rem 0 0;
	}
	.stat {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--bg-raised);
	}
	.stat dt {
		font: 500 0.6875rem/1 var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.stat dd {
		margin: 0;
		font: 500 1rem/1 var(--font-mono);
		color: var(--kind, var(--text));
	}
	.eyebrow {
		margin: 0 0 0.75rem;
		font: 500 0.75rem/1 var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	h1 {
		margin: 0;
		font: 400 clamp(2.5rem, 5vw, 3.5rem) / 1.05 var(--font-display);
		font-synthesis: none;
		letter-spacing: -0.02em;
		color: var(--text);
	}
	.lede {
		margin: 0.875rem 0 0;
		font-size: 1.0625rem;
		color: var(--text-dim);
	}

	/* Toolbar */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--line);
	}
	.segmented {
		display: inline-flex;
		padding: 3px;
		border: 1px solid var(--line);
		border-radius: calc(var(--r-sm) + 3px);
		background: var(--bg-sunken);
	}
	.segmented a {
		padding: 0.35rem 0.8rem;
		border-radius: var(--r-sm);
		font: 500 0.8125rem/1.2 var(--font-body);
		color: var(--text-dim);
		text-decoration: none;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}
	.segmented a:hover {
		color: var(--text);
	}
	.segmented a[aria-current='true'] {
		background: var(--bg-raised);
		color: var(--text);
		box-shadow:
			0 0 0 1px var(--line-strong),
			0 1px 2px rgb(0 0 0 / 0.15);
	}
	.segmented a:focus-visible,
	.packages a:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.empty {
		padding: 3rem 0;
		text-align: center;
		color: var(--text-dim);
	}

	/* Versions */
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.entry {
		scroll-margin-top: 80px;
		border-bottom: 1px solid var(--line);
	}
	details {
		padding-bottom: 1.5rem;
	}
	details:not([open]) {
		padding-bottom: 0;
	}
	summary {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.625rem;
		padding: 1.25rem 0;
		cursor: pointer;
		list-style: none;
		border-radius: var(--r-sm);
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.version {
		font: 500 1.375rem/1.2 var(--font-mono);
		letter-spacing: -0.01em;
		color: var(--text);
	}
	.badge {
		padding: 0.25rem 0.5rem;
		border: 1px solid color-mix(in srgb, var(--kind) 40%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--kind) 12%, transparent);
		font: 500 0.6875rem/1 var(--font-mono);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--kind);
	}
	.badge.minor,
	.badge.major {
		border-color: var(--kind);
		background: var(--kind);
		color: var(--text-on-invert);
	}
	.badge.pre {
		--kind: var(--text-dim);
	}
	.date {
		margin-left: auto;
		font: 400 0.8125rem/1 var(--font-mono);
		color: var(--text-faint);
	}
	.chev {
		margin-left: 0.5rem;
		width: 8px;
		height: 8px;
		border-right: 1.5px solid var(--text-faint);
		border-bottom: 1.5px solid var(--text-faint);
		transform: rotate(-45deg);
		transition: transform 150ms ease;
	}
	details[open] .chev {
		transform: rotate(45deg);
	}
	summary:hover .chev {
		border-color: var(--accent);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.pkg {
		padding: 1.125rem 1.25rem 1.25rem;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--bg-raised);
	}
	h2 {
		margin: 0 0 0.875rem;
		font: 500 0.9375rem/1.3 var(--font-mono);
		color: var(--text);
	}
	h2 a {
		color: inherit;
		text-decoration: none;
	}
	h2 a:hover {
		color: var(--accent);
	}
	h3 {
		margin: 1rem 0 0.5rem;
		font: 500 0.6875rem/1 var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--kind);
	}
	h2 + h3,
	.pkg > h3:first-child {
		margin-top: 0;
	}
	.pkg ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.pkg li {
		padding: 0.75rem 0;
		border-top: 1px solid var(--line);
	}
	.pkg li:last-child {
		padding-bottom: 0;
	}
	.pkg li:first-child {
		border-top: none;
		padding-top: 0.25rem;
	}
	.text {
		font-size: 0.9375rem;
		line-height: 1.65;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.text :global(code) {
		padding: 0.1rem 0.35rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg-sunken);
		font: 400 0.85em/1.4 var(--font-mono);
	}
	.text :global(a) {
		color: var(--accent);
	}
	.credits {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem 0.875rem;
		margin-top: 0.4rem;
		font: 400 0.75rem/1.4 var(--font-mono);
		color: var(--text-faint);
	}
	.credits a {
		color: var(--text-dim);
		text-decoration: none;
	}
	.credits a:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.deps {
		margin: 0.875rem 0 0;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--line);
		font: 400 0.75rem/1.5 var(--font-mono);
		color: var(--text-faint);
	}
	.bumped {
		margin: 0;
		padding: 0.25rem 0.25rem 0;
		font: 400 0.75rem/1.6 var(--font-mono);
		color: var(--text-faint);
	}
	.bumped span {
		margin-right: 0.5rem;
		font-family: var(--font-body);
		font-size: 0.8125rem;
	}
	.bumped a {
		color: var(--text-dim);
		text-decoration: none;
	}
	.bumped a:hover {
		color: var(--accent);
	}

	/* Versions rail */
	.rail {
		position: sticky;
		top: 57px;
		align-self: start;
		max-height: calc(100vh - 57px);
		overflow-y: auto;
		padding: 2rem 1.25rem 2rem 0;
	}
	.rail .nav-label {
		padding-inline: 0;
	}
	.rail ol {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 1px solid var(--line);
	}
	.rail a {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		margin-left: -1px;
		padding: 0.3rem 0 0.3rem 0.875rem;
		border-left: 1px solid transparent;
		font: 400 0.8125rem/1.3 var(--font-mono);
		color: var(--text-dim);
		text-decoration: none;
	}
	.rail a::before {
		content: '';
		flex: none;
		width: 6px;
		height: 6px;
		margin: auto 0;
		border-radius: 50%;
		background: var(--kind);
	}
	.rail-v {
		flex: 1;
	}
	.rail a:hover {
		border-left-color: var(--accent);
		color: var(--text);
	}
	.rail-d {
		color: var(--text-faint);
		font-size: 0.75rem;
	}

	@media (max-width: 75rem) {
		.releases {
			grid-template-columns: 248px minmax(0, 1fr);
		}
		.rail {
			display: none;
		}
	}
	@media (max-width: 52rem) {
		.releases {
			grid-template-columns: minmax(0, 1fr);
		}
		main {
			padding-top: 1.5rem;
		}
		.packages {
			height: auto;
			padding: 1rem var(--gutter);
			border-right: none;
			border-bottom: 1px solid var(--line);
			position: static;
			flex-direction: row;
			flex-wrap: nowrap;
			overflow-x: auto;
			max-height: none;
			gap: 0.25rem;
			padding-bottom: 0.25rem;
		}
		.nav-label {
			display: none;
		}
		.packages a {
			flex: none;
			border: 1px solid var(--line);
		}
		.pkg {
			padding: 1rem;
		}
	}
</style>
