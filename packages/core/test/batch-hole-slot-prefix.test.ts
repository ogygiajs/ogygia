// A hole's answer is spliced into a page that has its own slot sequence, so the slot ids minted in it
// carry the hole's region id (region-snippet.ts `next_slot_id`). The prefix belongs to the hole being
// rendered, not to the request's URL: a batch (a POST with no `?id`) renders many holes in one
// request, and each one's ids must carry its own prefix, as its own GET would.
import { describe, it, expect, vi } from 'vitest';
import { getContext } from 'svelte';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
const A = 'aaaaaa012345';
const B = 'bbbbbb012345';
const C = 'cccccc012345';
/** A hole whose tree mints one slot id, as Region does (with the render's slot sequence). */
const minting = ($$renderer: { push(s: string): void }) =>
	$$renderer.push(`<i>${next_slot_id('e', getContext(Symbol.for('ogygia.slot-sequence')))}</i>`);
/** A hole whose tree mints in a render root of its own (`await region(…)`, a held region): that
 *  root's context is made fresh, so it carries no slot sequence. */
const fresh_root = ($$renderer: { push(s: string): void }) =>
	$$renderer.push(`<i>${next_slot_id('e', undefined)}</i>`);
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => ({
		regions: {
			[A]: async () => ({ default: minting }),
			[B]: async () => ({ default: minting }),
			[C]: async () => ({ default: fresh_root })
		}
	}),
	region_url: { [A]: '/a.js', [B]: '/b.js', [C]: '/c.js' },
	region_name: {},
	region_render: {},
	render_region: {},
	region_reads_page_data: null
}));

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');
const { next_slot_id } = await import('../src/region-snippet.ts');
const { set_kit_event_reader } = await import('../src/server/kit-context.ts');

/** Kit's request store, as the handle reads it in an app: the request being handled. */
let current: unknown = null;
set_kit_event_reader(() => current);

const event = (url: string, init?: RequestInit) => {
	const u = new URL(url, 'https://app.test');
	return (current = {
		url: u,
		request: new Request(u, init),
		getClientAddress: () => '1.2.3.4',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	}) as never;
};
const resolve = async () => new Response('page');
const ids = (html: string) => [...html.matchAll(/<i>([^<]*)<\/i>/g)].map((m) => m[1]);

describe('slot ids in a hole’s answer', () => {
	it('a hole fetched on its own: its ids carry its region id', async () => {
		const res = await handle()({ event: event(mint_server_region(A, {})), resolve } as never);
		expect(ids(await res.text())).toEqual([expect.stringMatching(/^ogaaaaaa-/)]);
	});

	it('a hole fetched on its own: a render root inside it keeps its region id', async () => {
		const res = await handle()({ event: event(mint_server_region(C, {})), resolve } as never);
		expect(ids(await res.text())).toEqual([expect.stringMatching(/^ogcccccc-/)]);
	});

	const batch = (regions: string[]) =>
		handle()({
			event: event('/__ogygia__', {
				method: 'POST',
				body: JSON.stringify(regions.map((r) => mint_server_region(r, {}))),
				headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
			}),
			resolve
		} as never);

	it('holes fetched in one batch: each one’s ids carry its own region id', async () => {
		const minted = ids(await (await batch([A, B])).text()).sort();
		expect(minted).toEqual([
			expect.stringMatching(/^ogaaaaaa-/),
			expect.stringMatching(/^ogbbbbbb-/)
		]);
	});

	it('holes fetched in one batch: a render root inside one never mints a page’s id', async () => {
		const minted = ids(await (await batch([A, C])).text());
		expect(minted).toHaveLength(2);
		// (prefixed, so never one of the page's own `og<tag><n>`; and unique within the answer)
		for (const id of minted) expect(id).toMatch(/^og[a-z0-9]{6}-/);
		expect(new Set(minted).size).toBe(2);
	});
});
