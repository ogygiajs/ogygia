// Pager: the previous and next links of a page's trail, in a nav that is absent when there are none.
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Pager from '../src/site/components/Pager.svelte';
import type { NavRef } from '../src/site/types.ts';

const ref = (slug: string): NavRef => ({ slug, title: slug, href: `/docs/${slug}` });

async function pager(props: Record<string, unknown>) {
	const { body } = await render(Pager, { props: props as never });
	return body.replace(/<!--[^>]*-->/g, ''); // the hydration markers
}

describe('Pager', () => {
	it('renders nothing without a previous or next page', async () => {
		expect(await pager({ trail: {} })).toBe('');
	});

	it('links the previous and next page with their labels and titles', async () => {
		const body = await pager({
			trail: { prev: ref('a'), next: ref('b') },
			previousLabel: 'Back',
			nextLabel: 'On'
		});
		expect(body).toMatch(
			/<a class="og-pager-link og-pager-prev" href="\/docs\/a" rel="prev"><span class="og-pager-dir">Back<\/span> <span class="og-pager-title">a<\/span><\/a>/
		);
		expect(body).toMatch(
			/<a class="og-pager-link og-pager-next" href="\/docs\/b" rel="next"><span class="og-pager-dir">On<\/span> <span class="og-pager-title">b<\/span><\/a>/
		);
	});

	it('labels the links Previous and Next by default', async () => {
		const body = await pager({ trail: { prev: ref('a'), next: ref('b') } });
		expect(body).toContain('<span class="og-pager-dir">Previous</span>');
		expect(body).toContain('<span class="og-pager-dir">Next</span>');
	});

	it('keeps a lone next link in the second cell', async () => {
		const body = await pager({ trail: { next: ref('b') } });
		expect(body).toMatch(/^<nav class="og-pager"[^>]*><span><\/span> <a [^>]*rel="next"/);
	});
});
