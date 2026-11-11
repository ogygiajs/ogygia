// BlogList: the dated post list, newest first, grouped under year headings by default, each post a
// card unless the `item` snippet draws it.
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import BlogList from '../src/site/components/BlogList.svelte';
import type { BlogPostRef } from '../src/site/fields.ts';

const post = (href: string, date: string, extra: Partial<BlogPostRef> = {}): BlogPostRef => ({
	href,
	title: href.slice(1),
	date,
	...extra
});

const posts = [
	post('/old', '2024-03-01'),
	post('/new', '2025-06-02'),
	post('/mid-a', '2025-01-10'),
	post('/mid-b', '2025-01-10')
];

async function list(props: Record<string, unknown>) {
	const { body } = await render(BlogList, { props: { posts, ...props } as never });
	return body.replace(/ svelte-[a-z0-9]+/g, ''); // the scoped-style class
}

const hrefs = (body: string) =>
	[...body.matchAll(/<a class="og-blog-card" href="([^"]+)"/g)].map((m) => m[1]);

describe('BlogList', () => {
	it('lists the posts newest first, equal dates in the order given', async () => {
		expect(hrefs(await list({}))).toEqual(['/new', '/mid-a', '/mid-b', '/old']);
	});

	it('groups the posts under a heading per year by default', async () => {
		const body = await list({});
		const years = [...body.matchAll(/og-blog-year-label">(\d+)</g)].map((m) => m[1]);
		expect(years).toEqual(['2025', '2024']);
		expect(await list({ group: false })).not.toContain('og-blog-year-label');
	});

	it('draws a card with the date, title, summary, author and tags', async () => {
		const one = post('/p', '2025-06-02', { summary: 'Sum', author: 'Ann', tags: ['a', 'b'] });
		const body = await list({ posts: [one], title: 'News', intro: 'Lede' });
		expect(body).toContain('<h1 class="og-blog-title">News</h1>');
		expect(body).toContain('<p class="og-blog-intro">Lede</p>');
		expect(body).toContain('<time class="og-blog-card-date" datetime="2025-06-02">Jun 2</time>');
		expect(body).toContain('<h3 class="og-blog-card-title">p</h3>');
		expect(body).toContain('<p class="og-blog-card-summary">Sum</p>');
		expect(body).toContain('<span class="og-blog-card-author">Ann</span>');
		expect([...body.matchAll(/og-blog-card-tag">(\w+)</g)].map((m) => m[1])).toEqual(['a', 'b']);
	});

	it('lets the item snippet draw each post', async () => {
		const item = createRawSnippet((p: () => BlogPostRef) => ({
			render: () => `<b class="mine">${p().href}</b>`
		}));
		const body = await list({ item });
		expect(hrefs(body)).toEqual([]);
		expect([...body.matchAll(/<b class="mine">([^<]+)<\/b>/g)].map((m) => m[1])).toEqual([
			'/new',
			'/mid-a',
			'/mid-b',
			'/old'
		]);
	});
});
