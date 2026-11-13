// A HOLE THAT KEEPS ITS FALLBACK, ON THE ENDPOINT (hooks.ts, `render_component`). `keepFallback()`
// ends the hole's render on purpose: the endpoint answers 204, no content, and the runtime keeps
// the page's fallback. It is no failure: never the 500 a render that throws gets, never said.
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
const { ID } = vi.hoisted(() => ({ ID: 'abcdef0123aa' }));
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => ({
		regions: { [ID]: () => import('./_fixtures/KeepHole.svelte') }
	}),
	region_url: { [ID]: '/x.js' },
	region_name: {},
	region_render: {},
	render_region: {},
	region_reads_page_data: null
}));

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');

const event = (url: string) => {
	const u = new URL(url, 'https://app.test');
	return {
		url: u,
		request: new Request(u),
		getClientAddress: () => '1.2.3.4',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	} as never;
};

afterEach(() => vi.restoreAllMocks());

it('a hole whose render keeps its fallback answers 204 with no content, and nothing is said', async () => {
	const said: string[] = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void said.push(a.join(' ')));
	vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void said.push(a.join(' ')));
	const res = await handle()({
		event: event(mint_server_region(ID, {})),
		resolve: async () => new Response('page')
	} as never);
	expect(res.status).toBe(204);
	expect(await res.text()).toBe('');
	expect(said).toEqual([]);
});
