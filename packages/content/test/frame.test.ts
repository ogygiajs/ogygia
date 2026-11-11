// Frame: sidebar plus main. Each region is replaced by a component, removed by `false` or `null`,
// or left to its default; the shell context it sets reaches what it renders.
import { page } from '$app/state';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import Frame from '../src/site/components/Frame.svelte';
import type { NavTree } from '../src/site/types.ts';
import RegionProbe from './fixtures/RegionProbe.svelte';

const tree: NavTree = [{ kind: 'leaf', slug: 'intro', href: '/docs/intro', title: 'Intro' }];

async function frame(props: Record<string, unknown> = {}) {
	const asked: { base: string; slug: string }[] = [];
	const site = {
		components: {},
		async nav(o: { base: string; slug: string }) {
			asked.push(o);
			return tree;
		}
	};
	const children = createRawSnippet(() => ({ render: () => '<p>body</p>' }));
	const { body } = await render(Frame, { props: { site, children, ...props } });
	return { body, asked };
}

// [base, same site] as the region component read them from the shell context.
function probe(body: string, tag: string) {
	const at = `<${tag}>(?:<!--[^>]*-->)*<span class="probe"`;
	return body.match(new RegExp(`${at} data-base="([^"]*)" data-same-site="(\\w+)"`))?.slice(1);
}

afterEach(() => {
	page.url = new URL('http://localhost/');
	page.params = {};
});

describe('Frame', () => {
	it('renders the site nav tree in the default sidebar', async () => {
		const { body } = await frame();
		expect(body).toMatch(/<aside class="og-side">.*<a class="og-nav-link" href="\/docs\/intro"/s);
	});

	it('replaces the sidebar with a component, and removes it for false or null', async () => {
		const { body } = await frame({ sidebar: RegionProbe });
		expect(probe(body, 'aside class="og-side"')).toBeDefined();
		expect(body).not.toContain('og-sidebar');
		for (const sidebar of [false, null])
			expect((await frame({ sidebar })).body).not.toContain('<aside');
	});

	it('has no header or footer unless given one', async () => {
		const bare = (await frame()).body;
		expect(bare).not.toContain('<header');
		expect(bare).not.toContain('<footer');
		const { body } = await frame({ header: RegionProbe, footer: RegionProbe });
		expect(probe(body, 'header class="og-header"')).toBeDefined();
		expect(probe(body, 'footer class="og-footer"')).toBeDefined();
	});

	it('sets the shell context: the site, and the mount base taken from the page', async () => {
		page.url = new URL('http://localhost/docs/guide/intro');
		page.params = { slug: 'guide/intro' };
		const { body, asked } = await frame({ header: RegionProbe });
		expect(probe(body, 'header class="og-header"')).toEqual(['/docs', 'true']);
		expect(asked).toEqual([{ base: '/docs', slug: 'guide/intro' }]);
	});

	it('uses the base prop over the one taken from the page', async () => {
		page.url = new URL('http://localhost/docs/guide/intro');
		page.params = { slug: 'guide/intro' };
		const { body, asked } = await frame({ header: RegionProbe, base: '/v2' });
		expect(probe(body, 'header class="og-header"')).toEqual(['/v2', 'true']);
		expect(asked[0]?.base).toBe('/v2');
	});

	it('starts with a skip link to the main landmark', async () => {
		const { body } = await frame();
		const first = body.match(/<(a|button|input|select|textarea)\b[^>]*>/)?.[0];
		expect(first).toBe('<a class="og-skip" href="#og-main">');
		expect(body).toMatch(/<main class="og-main" id="og-main" tabindex="-1">/);
	});
});
