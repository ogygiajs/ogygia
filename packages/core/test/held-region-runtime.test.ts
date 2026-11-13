/**
 * A page that awaits a held region in its own render ships the runtime script. The held region
 * renders in a render root of its own (server/render-region-html.ts), whose head is dropped but for
 * its region-CSS links. With the router off, nothing else injects the runtime: an island inside the
 * held region must not take the page's one runtime claim into that dropped head.
 */
import { afterEach, expect, test } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import { region } from '../src/region.ts';
import { render_region_html } from '../src/server/render-region-html.ts';
import HeldIslandBlock from './_fixtures/HeldIslandBlock.svelte';
import HeldIslandPage from './_fixtures/HeldIslandPage.svelte';

const BLOCK = '/islands/held-block.js';
const RUNTIME_RE = /data-ogygia-runtime/;

afterEach(() => set_request_event_stub(null));

test('a page that awaits a held region with an island inside ships the runtime script', async () => {
	// ONE event object for the whole request: the page's render and the held region's render root
	const event = {
		route: { id: '/held-page' },
		request: new Request('http://example.com/held-page')
	};
	set_request_event_stub(() => event);
	const block = HeldIslandBlock as unknown as Component<Record<string, unknown>>;
	const binding = {
		__ogRegion: 'held-island-block',
		__module: BLOCK,
		__component: block,
		__sign: (id: string) => `/__ogygia__?id=${id}`,
		__renderHtml: (props: Record<string, unknown>, wakes?: boolean) =>
			render_region_html(block, BLOCK, props, wakes)
	};
	// the page's `await region(...)`, in its render
	const held = await region(binding as never, {} as never);
	const out = render(HeldIslandPage as unknown as Component<{ held: unknown }>, {
		props: { held }
	});
	const document = out.head + out.body;
	expect(out.body).toContain('data-tiny');
	expect(RUNTIME_RE.test(document), 'the page carries the runtime script').toBe(true);
});
