// A tab group's server HTML: each Tab is a plain panel whose label rides `data-label` (where the
// island builds its bar from), and TabGroup hands its group and panels to that island.
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Tab from '../src/site/components/Tab.svelte';
import TabGroup from '../src/site/components/TabGroup.svelte';

const text = (html: string) => createRawSnippet(() => ({ render: () => html }));

describe('Tab', () => {
	it('renders a tab panel that carries its label in data-label', async () => {
		const { body } = await render(Tab, { props: { label: 'npm', children: text('<p>npm i</p>') } });
		expect(body).toContain(
			'<div class="og-tabs-panel" role="tabpanel" data-label="npm" aria-label="npm"><p>npm i</p>'
		);
	});
});

describe('TabGroup', () => {
	it('hands its group and its panels to the island', async () => {
		const { body } = await render(TabGroup, {
			props: { group: 'pm', children: text('<div class="og-tabs-panel" data-label="npm"></div>') }
		});
		expect(body).toMatch(
			/<div class="og-tabs" data-group="pm">\s*<div class="og-tabs-panels"><div class="og-tabs-panel" data-label="npm"><\/div>/
		);
	});

	it('uses the "tabs" group when none is given', async () => {
		const { body } = await render(TabGroup, { props: { children: text('<div></div>') } });
		expect(body).toContain('data-group="tabs"');
	});
});
