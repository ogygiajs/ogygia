<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { CmsPage } from './cms';

	// The markup of a large CMS page (./cms.ts). `children` renders at the end of <main>.
	let { page, children }: { page: CmsPage; children?: Snippet } = $props();
	const PIXEL =
		'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/%3E';
</script>

<svelte:head>
	{@html `<style>${page.css}</style>`}
</svelte:head>

<div data-sveltekit-preload-data="hover" data-cms-page>
	<header>
		<nav aria-label="main">
			<ul>
				{#each page.menus as menu (menu.label)}
					<li>
						<button type="button">{menu.label}</button>
						<div class="mega">
							{#each menu.columns as column (column.title)}
								<div>
									<h4>{column.title}</h4>
									<ul>
										{#each column.links as link (link.href)}
											<li><a href={link.href}>{link.label}</a></li>
										{/each}
									</ul>
								</div>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		</nav>
		<form action="/search" role="search">
			<input name="q" type="search" placeholder="Search" />
			<button>Go</button>
		</form>
	</header>

	<main>
		{#each page.sections as section (section.id)}
			<section id={section.id}>
				<h2>{section.title}</h2>
				<p><strong>{section.title}:</strong> <span>{section.text}</span> <em>more</em></p>
				<img src={PIXEL} alt="" width="400" height="300" loading="lazy" />
				<ul>
					{#each section.items as item (item.href)}
						<li><a href={item.href}><span>{item.label}</span></a></li>
					{/each}
				</ul>
				<dl>
					{#each section.facts as fact (fact.term)}
						<dt>{fact.term}</dt>
						<dd>{fact.value}</dd>
					{/each}
				</dl>
				<div class="cards">
					{#each section.cards as card (card.href)}
						<article>
							<img src={PIXEL} alt="" width="200" height="150" loading="lazy" />
							<h3>{card.title}</h3>
							<p>{card.text}</p>
							<a href={card.href}>Read more</a>
						</article>
					{/each}
				</div>
				{#if section.id.endsWith('0')}
					<form method="post" action="/contact">
						<fieldset>
							<legend>Contact</legend>
							{#each ['name', 'email', 'phone', 'company', 'city'] as field (field)}
								<label>{field} <input name={field} /></label>
							{/each}
							<select name="topic"><option>a</option><option>b</option></select>
							<textarea name="message"></textarea>
							<button>Send</button>
						</fieldset>
					</form>
				{/if}
			</section>
		{/each}
		{@render children?.()}
	</main>

	<footer>
		{#each page.footer as column (column.title)}
			<div>
				<h4>{column.title}</h4>
				<ul>
					{#each column.links as link (link.href)}
						<li><a href={link.href}>{link.label}</a></li>
					{/each}
				</ul>
			</div>
		{/each}
	</footer>
</div>
