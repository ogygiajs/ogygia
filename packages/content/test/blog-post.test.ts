// BlogPost: one post from a `PageView`. A dateline (date and author), the title, summary and tags,
// an optional back link and footer, and links to the previous and next post.
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import BlogPost from '../src/site/components/BlogPost.svelte';
import type { NavRef, PageView } from '../src/site/types.ts';

const SHELL = Symbol.for('ogygia.content.shell');
const ref = (slug: string): NavRef => ({ slug, title: slug, href: `/blog/${slug}` });

function view(data: Record<string, unknown>, trail: Record<string, unknown> = {}) {
	return { slug: 'hello', entry: { data }, trail } as unknown as PageView;
}

async function post(props: Record<string, unknown>, shell?: Record<string, unknown>) {
	const context = new Map<unknown, unknown>(shell ? [[SHELL, shell]] : []);
	const { body, head } = await render(BlogPost, { props: props as never, context });
	const strip = (s: string) => s.replace(/ svelte-[a-z0-9]+/g, ''); // the scoped-style class
	return { body: strip(body), head };
}

describe('BlogPost', () => {
	it('shows the dateline, title, summary and tags from the post data', async () => {
		const { body } = await post({
			view: view({
				title: 'Hello',
				date: '2025-06-02',
				author: 'Ann',
				summary: 'Sum',
				tags: ['a', 'b']
			})
		});
		expect(body).toMatch(/<time datetime="2025-06-02">June 2, 2025<\/time>/);
		expect(body).toContain('<span class="og-post-author">Ann</span>');
		expect(body).toContain('<h1 class="og-post-title">Hello</h1>');
		expect(body).toContain('<p class="og-post-summary">Sum</p>');
		expect([...body.matchAll(/<li class="og-post-tag">(\w+)<\/li>/g)].map((m) => m[1])).toEqual([
			'a',
			'b'
		]);
	});

	it('falls back to the slug for the title', async () => {
		const { body } = await post({ view: view({}) });
		expect(body).toContain('<h1 class="og-post-title">hello</h1>');
	});

	it('writes the title, with the site title, and the post facts into the head', async () => {
		const data = { title: 'Hello', date: '2025-06-02', author: 'Ann', summary: 'Sum' };
		const { head } = await post({ view: view(data) }, { title: 'Site' });
		expect(head).toContain('<title>Hello — Site</title>');
		expect(head).toContain('<meta name="description" content="Sum"/>');
		expect(head).toContain('<meta name="author" content="Ann"/>');
		expect(head).toContain('<meta property="article:published_time" content="2025-06-02"/>');
	});

	it('links back to the index only when given back', async () => {
		expect((await post({ view: view({}) })).body).not.toContain('og-post-back');
		const { body } = await post({ view: view({}), back: '/blog', backLabel: 'All' });
		expect(body).toContain('<a class="og-post-back" href="/blog">All</a>');
	});

	it('renders the footer snippet after the post', async () => {
		const footer = createRawSnippet(() => ({ render: () => '<b>cta</b>' }));
		const { body } = await post({ view: view({}), footer });
		expect(body).toContain('<div class="og-post-footer"><b>cta</b>');
	});

	it('links the previous and next post, and has no pager without them', async () => {
		expect((await post({ view: view({}) })).body).not.toContain('og-post-pager');
		const { body } = await post({ view: view({}, { prev: ref('older'), next: ref('newer') }) });
		expect(body).toMatch(/href="\/blog\/older" rel="prev"/);
		expect(body).toMatch(/href="\/blog\/newer" rel="next"/);
	});
});
