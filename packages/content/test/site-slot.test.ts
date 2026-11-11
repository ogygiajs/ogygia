// SiteSlot: an overridable markdown tag renders the site's component for it, else Link for `a`,
// else the plain element.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ShellContext } from '../src/site/context.ts';
import type { Site } from '../src/site/site.ts';
import Shout from './fixtures/Shout.svelte';
import SlotHost from './fixtures/SlotHost.svelte';

// A site whose outline knows one page, `intro`, so Link's slug-form href resolves under the base.
const site = {
	outline: {
		resolve: async (slug: string) => (slug === 'intro' ? { record: { slug: 'intro' } } : null),
		alias: async () => null
	}
} as unknown as Site;

const shout = Shout as unknown as Component<Record<string, unknown>>;

async function slot(tag: string, attrs: Record<string, unknown>, ctx?: ShellContext) {
	const { body } = await render(SlotHost, { props: { tag, attrs, ctx } });
	return body.replace(/<!--[^>]*-->/g, ''); // the hydration markers
}

describe('SiteSlot', () => {
	it('renders the component the site maps the tag to, with its attributes and children', async () => {
		const body = await slot('em', { title: 't' }, { base: '/docs', components: { em: shout } });
		expect(body).toBe('<strong data-shout="true" title="t">slotted</strong>');
	});

	it('renders the plain element when nothing maps the tag', async () => {
		const body = await slot('em', { title: 't' }, { base: '/docs', components: {} });
		expect(body).toBe('<em title="t">slotted</em>');
		expect(await slot('em', { title: 't' })).toBe('<em title="t">slotted</em>');
	});

	it('renders `a` through Link by default, so a slug-form href resolves under the base', async () => {
		const body = await slot('a', { href: 'intro' }, { base: '/docs', site });
		expect(body).toBe('<a href="/docs/intro">slotted</a>');
	});

	it("lets the site's own `a` win over the default Link", async () => {
		const body = await slot(
			'a',
			{ href: 'intro' },
			{ base: '/docs', site, components: { a: shout } }
		);
		expect(body).toBe('<strong data-shout="true" href="intro">slotted</strong>');
	});
});
