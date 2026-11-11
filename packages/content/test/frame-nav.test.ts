// Frame builds the site's nav tree only for its default sidebar: a replaced or removed sidebar
// never asks the site for it.
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Frame from '../src/site/components/Frame.svelte';
import RegionProbe from './fixtures/RegionProbe.svelte';

async function nav_calls(sidebar: unknown) {
	let calls = 0;
	const site = {
		components: {},
		async nav() {
			calls++;
			return [];
		}
	};
	const children = createRawSnippet(() => ({ render: () => '<p>body</p>' }));
	await render(Frame, { props: { site, children, sidebar } as never });
	return calls;
}

describe('Frame nav tree', () => {
	it('asks the site for the nav tree once for the default sidebar', async () => {
		expect(await nav_calls(undefined)).toBe(1);
	});

	it('does not ask the site for the nav tree when the sidebar is replaced', async () => {
		expect(await nav_calls(RegionProbe)).toBe(0);
	});

	it('does not ask the site for the nav tree when the sidebar is removed', async () => {
		expect(await nav_calls(false)).toBe(0);
		expect(await nav_calls(null)).toBe(0);
	});
});
