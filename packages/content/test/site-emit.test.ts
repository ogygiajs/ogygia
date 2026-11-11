// The site's machine-facing files, built from a nav tree: nested groups give up their leaves.
import { describe, expect, it } from 'vitest';
import { build_llms, build_sitemap } from '../src/site/emit.ts';
import type { NavTree } from '../src/site/types.ts';

const tree: NavTree = [
	{ kind: 'leaf', slug: 'intro', href: '/docs/intro', title: 'Intro' },
	{
		kind: 'group',
		label: 'Guide',
		items: [
			{ kind: 'leaf', slug: 'guide/a', href: '/docs/guide/a', title: 'A', summary: 'first' },
			{
				kind: 'group',
				label: 'Deeper',
				items: [{ kind: 'leaf', slug: 'guide/deep/b', href: '/docs/guide/deep/b', title: 'B' }]
			},
			{ kind: 'link', label: 'Elsewhere', href: 'https://example.com/x' }
		]
	}
];

describe('emissions over a nested nav tree', () => {
	it('the sitemap lists the leaves of nested groups, as absolute URLs', () => {
		const locs = [...build_sitemap(tree, 'https://example.com').matchAll(/<loc>(.*?)<\/loc>/g)].map(
			(m) => m[1]
		);
		expect(locs).toEqual([
			'https://example.com/docs/intro',
			'https://example.com/docs/guide/a',
			'https://example.com/docs/guide/deep/b'
		]);
	});

	it('llms.txt flattens a nested group into its section, with summaries and plain links', () => {
		const txt = build_llms(tree, 'https://example.com', { title: 'T' });
		expect(txt).toBe(
			[
				'# T',
				'',
				'## Pages',
				'',
				'- [Intro](https://example.com/docs/intro)',
				'',
				'## Guide',
				'',
				'- [A](https://example.com/docs/guide/a): first',
				'- [B](https://example.com/docs/guide/deep/b)',
				'- [Elsewhere](https://example.com/x)',
				''
			].join('\n')
		);
	});
});
