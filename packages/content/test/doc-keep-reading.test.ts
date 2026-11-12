// Doc's "Keep reading" cards come from the `keepReading` prop when it is set, else from the
// trail's suggested refs (#644).
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Doc from '../src/site/components/Doc.svelte';
import type { NavRef, PageView } from '../src/site/types.ts';

const ref = (slug: string): NavRef => ({ slug, title: slug, href: `/docs/${slug}` });

const view = {
	slug: 'intro',
	href: '/docs/intro',
	entry: { data: { title: 'Intro' } },
	section: 'Guides',
	crumbs: [],
	headings: [],
	trail: { related: [ref('curated')], suggested: [ref('picked')] }
} as unknown as PageView;

async function cards(props: Record<string, unknown>) {
	const { body } = await render(Doc, { props: { view, pager: false, toc: false, ...props } });
	return [...body.matchAll(/class="og-suggested-card" href="([^"]+)"/g)].map((m) => m[1]);
}

describe('Doc keepReading', () => {
	it('shows the trail suggested refs when keepReading is not set', async () => {
		expect(await cards({})).toEqual(['/docs/picked']);
	});

	it('shows the keepReading refs instead of the trail suggested refs when set', async () => {
		expect(await cards({ keepReading: view.trail.related })).toEqual(['/docs/curated']);
	});

	it('shows no keep reading block when keepReading is empty', async () => {
		expect(await cards({ keepReading: [] })).toEqual([]);
	});

	it('shows no keep reading block when suggested is off', async () => {
		expect(await cards({ suggested: false, keepReading: view.trail.related })).toEqual([]);
	});
});
