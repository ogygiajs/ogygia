/**
 * A RENDER HOLDS ITS PAGE'S FACTS (#993). A render for a page looks the page up through a flight the
 * request owns, then renders from the answer. It must render from the answer the look-up gave it,
 * not from what the flight still keeps: an answer a flight does not keep (the simulator's
 * `flights.not-kept`) left `page.data` empty, silently. Here every flight's answer is not kept.
 */
import { describe, it, expect, vi } from 'vitest';
import * as devalue from 'devalue';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('@ogygia/machine', async (original) => {
	const actual = await original<typeof import('@ogygia/machine')>();
	const real = actual.flights;
	const flights = Object.assign((...a: unknown[]) => (real as (...a: unknown[]) => unknown)(...a), {
		...real,
		keyed: () => (def: Record<string, unknown>) =>
			real.keyed<never>()({ ...def, keep: () => 0 } as never)
	});
	return { ...actual, flights };
});

const { prepare_render_page, render_page, render_page_version } =
	await import('../src/server/render-page.ts');

const kit_data = (data: Record<string, unknown>) =>
	`${JSON.stringify({
		type: 'data',
		nodes: [{ type: 'data', data: JSON.parse(devalue.stringify(data)), uses: {} }]
	})}\n`;

describe('a render for a page, its look-up not kept', () => {
	it('renders with the facts its look-up answered', async () => {
		const event = {
			url: new URL('https://a.test/_app/remote/abc/header'),
			request: new Request('https://a.test/_app/remote/abc/header', {
				headers: { referer: 'https://a.test/p2' }
			}),
			params: {},
			route: { id: null },
			isRemoteRequest: true,
			fetch: (async () =>
				new Response(kit_data({ who: 'p2 data' }), {
					headers: { 'content-type': 'text/sveltekit-data' }
				})) as RequestEvent['fetch'],
			cookies: { get: () => undefined }
		} as unknown as RequestEvent;
		await prepare_render_page(event, undefined, null);
		expect(render_page(undefined, event)!.data).toEqual({ who: 'p2 data' });
		expect(render_page_version(event, undefined)).not.toBe('');
	});
});
