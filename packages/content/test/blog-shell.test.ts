// BlogShell: the blog's page frame. A header (brand, links, search, theme, actions) over one column
// that holds the page; it needs no site.
import { page } from '$app/state';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import BlogShell from '../src/site/components/BlogShell.svelte';

const html = (s: string) => createRawSnippet(() => ({ render: () => s }));

async function shell(props: Record<string, unknown> = {}) {
	const { body } = await render(BlogShell, {
		props: { children: html('<p>page</p>'), ...props } as never
	});
	// without the scoped-style class and the hydration markers
	return body.replace(/ svelte-[a-z0-9]+/g, '').replace(/<!--[^>]*-->/g, '');
}

afterEach(() => {
	page.url = new URL('http://localhost/');
	page.params = {};
});

describe('BlogShell', () => {
	it('renders the page in one main column, with no sidebar, without a site', async () => {
		const body = await shell();
		expect(body).toMatch(/<main class="og-bmain" id="og-main" tabindex="-1"><p>page<\/p>/);
		expect(body).not.toContain('<aside');
	});

	it('puts the brand, links, theme toggle and actions in the header', async () => {
		const body = await shell({
			title: 'News',
			links: [{ text: 'About', href: '/about' }],
			actions: html('<a class="rss">rss</a>')
		});
		const header = body.match(/<header class="og-bheader">[\s\S]*<\/header>/)?.[0] ?? '';
		expect(header).toMatch(/<a class="og-bheader-brand" href="\/">News<\/a>/);
		expect(header).toContain('<a class="og-bheader-link" href="/about">About</a>');
		expect(header).toContain('og-theme-toggle');
		expect(header).toContain('<div class="og-bheader-actions"><a class="rss">rss</a>');
	});

	it('draws the brand snippet in place of the title', async () => {
		const body = await shell({ title: 'News', brand: html('<b>logo</b>') });
		expect(body).toMatch(/<a class="og-bheader-brand" href="\/"><b>logo<\/b><\/a>/);
	});

	it('shows the search only when asked', async () => {
		expect(await shell()).not.toContain('og-bheader-search');
		expect(await shell({ search: true })).toContain('og-bheader-search');
	});

	it('links the brand to the blog root taken from the page, or the base prop', async () => {
		page.url = new URL('http://localhost/blog/hello');
		page.params = { slug: 'hello' };
		expect(await shell()).toContain('<a class="og-bheader-brand" href="/blog">');
		expect(await shell({ base: '/news' })).toContain('<a class="og-bheader-brand" href="/news">');
	});
});
