// A post's date (`2025-06-02`) is a calendar day: BlogList and BlogPost show that day whatever time
// zone the server renders in.
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BlogList from '../src/site/components/BlogList.svelte';
import BlogPost from '../src/site/components/BlogPost.svelte';
import type { PageView } from '../src/site/types.ts';

const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'];

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('blog dates', () => {
	for (const zone of ZONES)
		it(`shows the post's own day in the list and the post when the server is in ${zone}`, async () => {
			vi.stubEnv('TZ', zone);
			const list = await render(BlogList, {
				props: { posts: [{ href: '/p', title: 'P', date: '2025-06-02' }] }
			});
			expect(list.body).toMatch(/datetime="2025-06-02">Jun 2</);

			const view = {
				slug: 'p',
				entry: { data: { title: 'P', date: '2025-06-02' } },
				trail: {}
			} as unknown as PageView;
			const post = await render(BlogPost, { props: { view } });
			expect(post.body).toMatch(/datetime="2025-06-02">June 2, 2025</);
		});
});
