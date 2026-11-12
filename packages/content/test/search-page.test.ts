// SearchPage: search that works with no JavaScript, a GET form and the results rendered on the server.
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import SearchPage from '../src/site/components/SearchPage.svelte';
import type { SearchHit } from '../src/site/search.ts';

const hit = (slug: string, more: Partial<SearchHit> = {}): SearchHit => ({
	href: `/docs/${slug}`,
	slug,
	title: slug,
	section: 'Guide',
	heading: '',
	excerpt: '',
	score: 1,
	...more
});

async function search_page(props: Record<string, unknown>) {
	const { body } = await render(SearchPage, { props: props as never });
	return body.replace(/<!--[^>]*-->/g, ''); // the hydration markers
}

describe('SearchPage', () => {
	it('is a GET form that sends the term as q, to the current URL unless given an action', async () => {
		const body = await search_page({ q: 'runes' });
		expect(body).toMatch(/<form [^>]*role="search" method="get"[^>]*>/);
		expect(body).not.toMatch(/<form [^>]*action=/);
		expect(body).toMatch(/<input [^>]*type="search" name="q" value="runes"/);
		expect(body).toMatch(/<button [^>]*type="submit">Search<\/button>/);
		const elsewhere = await search_page({ action: '/docs/search' });
		expect(elsewhere).toMatch(/<form [^>]*action="\/docs\/search"/);
	});

	it('shows the title and placeholder, Search and Search the docs… by default', async () => {
		const body = await search_page({});
		expect(body).toContain('<h1 class="og-title">Search</h1>');
		expect(body).toMatch(/placeholder="Search the docs…" aria-label="Search the docs…"/);
		const own = await search_page({ title: 'Find', placeholder: 'Find a page' });
		expect(own).toContain('<h1 class="og-title">Find</h1>');
		expect(own).toMatch(/placeholder="Find a page" aria-label="Find a page"/);
	});

	it('lists nothing and counts nothing before a term is given', async () => {
		const body = await search_page({ hits: [hit('a')] });
		expect(body).not.toContain('og-searchpage-count');
		expect(body).not.toContain('og-search-hit');
	});

	it('renders each hit on the server: a link with its title, heading, excerpt and section', async () => {
		const body = await search_page({
			q: 'state',
			hits: [
				hit('a', { title: 'Runes', heading: 'State', excerpt: 'the <mark>state</mark> rune' }),
				hit('b', { title: 'Stores', section: 'Reference' })
			]
		});
		expect(body).toContain('2 results for “state”');
		expect(body).toMatch(
			/<a class="og-search-hit" href="\/docs\/a"><span class="og-search-hit-title">Runes<span class="og-search-hit-heading">\s*› State<\/span><\/span> <span class="og-search-hit-excerpt">the <mark>state<\/mark> rune<\/span> <span class="og-search-hit-section">Guide<\/span><\/a>/
		);
		expect(body).toMatch(
			/<a class="og-search-hit" href="\/docs\/b"><span class="og-search-hit-title">Stores<\/span>\s+<span class="og-search-hit-section">Reference<\/span><\/a>/
		);
	});

	it('counts one result in the singular', async () => {
		expect(await search_page({ q: 'x', hits: [hit('a')] })).toContain('1 result for “x”');
	});

	it('says there are no results for a term that found none', async () => {
		const body = await search_page({ q: 'zzz', hits: [] });
		expect(body).toContain('0 results for “zzz”');
		expect(body).toContain(
			'<p class="og-search-empty og-searchpage-empty">No results for “zzz”.</p>'
		);
		expect(body).not.toContain('<ul');
	});
});
