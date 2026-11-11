// A doc page's server HTML: its document title names the site when the shell does, and the
// breadcrumb trail is off unless asked for (the section eyebrow already names the section).
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Doc from '../src/site/components/Doc.svelte';
import type { PageView } from '../src/site/types.ts';

const view = {
	slug: 'intro',
	href: '/docs/guides/intro',
	entry: { data: { title: 'Intro' } },
	section: 'Guides',
	crumbs: [{ label: 'Guides' }, { label: 'Intro' }],
	headings: [],
	trail: { related: [], suggested: [] }
} as unknown as PageView;

const SHELL = Symbol.for('ogygia.content.shell');

async function page(props: Record<string, unknown>, shell?: { title?: string }) {
	const context = new Map<unknown, unknown>(shell ? [[SHELL, shell]] : []);
	return render(Doc, { props: { view, pager: false, ...props }, context });
}

describe('Doc', () => {
	it('titles the document "Page — Site" when the shell names a site, else the page alone', async () => {
		expect((await page({}, { title: 'Acme Docs' })).head).toContain(
			'<title>Intro — Acme Docs</title>'
		);
		expect((await page({})).head).toContain('<title>Intro</title>');
	});

	it('leaves the breadcrumb trail out unless asked for', async () => {
		expect((await page({})).body).not.toContain('og-crumbs');
		expect((await page({ crumbs: true })).body).toContain('og-crumbs');
	});
});
