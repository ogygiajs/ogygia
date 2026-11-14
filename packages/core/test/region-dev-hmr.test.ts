import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

vi.mock('../src/dev-hmr-url.ts', () => ({ dev_hmr_url: '/@id/__x00__ogygia:dev/hmr' }));

const { default: Region } = await import('../src/Region.svelte');
const { default: Tiny } = await import('./_fixtures/Tiny.svelte');
const { set_request_event_stub } = await import('./_stubs/server.request-event.ts');

afterEach(() => set_request_event_stub(null));

test('in dev, the runtime a region ships brings the soft-HMR bridge beside it', () => {
	set_request_event_stub(() => ({
		route: { id: '/plain' },
		request: new Request('https://app.test/plain')
	}));
	const { head } = render(Region as unknown as Component<Record<string, unknown>>, {
		props: { __mode: 'island', __entry: '/islands/tiny.js', __component: Tiny, __props: {} }
	});
	expect(head).toContain(
		'<script type="module" data-ogygia-dev-hmr src="/@id/__x00__ogygia:dev/hmr"></script>'
	);
});
