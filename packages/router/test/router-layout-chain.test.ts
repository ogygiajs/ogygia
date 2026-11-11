import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import LayoutChain from '../src/LayoutChain.svelte';
import Outer from './layout-chain/Outer.svelte';
import Inner from './layout-chain/Inner.svelte';
import Page from './layout-chain/Page.svelte';
import Loading from './layout-chain/Loading.svelte';

const html = (props: Record<string, unknown>) =>
	render(LayoutChain as never, { props: props as never })
		.body.replace(/<!--[^>]*-->/g, '')
		.replace(/>\s+</g, '><');

describe('LayoutChain', () => {
	it('nests the layouts outermost first around the page, each reading the data', () => {
		expect(
			html({
				chain: [Outer, Inner],
				component: Page,
				props: { title: 'Hi' },
				data: { user: 'ada' }
			})
		).toBe(
			'<div class="outer" data-user="ada"><div class="inner"><p class="page">Hi</p></div></div>'
		);
	});

	it("hands a deferred page's fallback to it as its ogygiaFallback snippet, with the data", () => {
		expect(
			html({
				chain: [],
				component: Page,
				props: { title: 'Hi' },
				data: { user: 'ada' },
				fallback: Loading
			})
		).toBe('<p class="page">Hi</p><p class="loading">loading for ada</p>');
	});
});
