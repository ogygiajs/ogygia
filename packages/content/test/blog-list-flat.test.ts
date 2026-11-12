// BlogList with `group={false}` is one flat list in the order given, so an app can pre-sort; the
// default grouped list stays newest first.
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import BlogList from '../src/site/components/BlogList.svelte';
import type { BlogPostRef } from '../src/site/fields.ts';

const post = (href: string, date: string): BlogPostRef => ({ href, title: href, date });

// pinned first, then by date: an order the app chose
const posts = [
	post('/pinned', '2023-01-01'),
	post('/new', '2025-06-02'),
	post('/old', '2024-03-01')
];

async function hrefs(group: boolean) {
	const { body } = await render(BlogList, { props: { posts, group } });
	return [...body.matchAll(/<a class="og-blog-card[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
}

describe('BlogList flat order', () => {
	it('keeps the given order when group is false', async () => {
		expect(await hrefs(false)).toEqual(['/pinned', '/new', '/old']);
	});

	it('still lists newest first when grouped', async () => {
		expect(await hrefs(true)).toEqual(['/new', '/old', '/pinned']);
	});
});
