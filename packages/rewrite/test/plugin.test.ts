import { describe, it, expect } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { handle as ogygia_handle } from '@ogygia/core/server';
import { rewrite as rewrite_plugin } from '../src/vite.ts';
import server from '../src/server.ts';
import { rewrite } from '../src/index.ts';
import { slot } from '../src/requests.ts';

const event_of = (request: Request) => ({ request, url: new URL(request.url) }) as RequestEvent;
const ok = async () => new Response('ok');
const same = rewrite({ match: 'demo-', render: (els) => els.map((e) => e.html) });

describe('rewrite() in vite.config', () => {
	it('takes no options, is named by its package and names its realms, the modules beside it', () => {
		const plugin = rewrite_plugin();
		expect(rewrite_plugin.length).toBe(0);
		expect(plugin.name).toBe('@ogygia/rewrite');
		expect((plugin as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.plugin')]).toEqual({
			name: '@ogygia/rewrite',
			server: new URL('../src/server.ts', import.meta.url).href,
			client: new URL('../src/client.ts', import.meta.url).href
		});
	});
});

describe('a rewrite() handle', () => {
	it('refuses every request while rewrite() is not in vite.config, naming the fix', () => {
		slot.live = false;
		const event = event_of(new Request('http://x/'));
		expect(() => same({ event, resolve: ok })).toThrow(/rewrite_plugin_missing/);
	});

	it('gives a pass to the requests it wrapped, and to no other', async () => {
		startPlugin(server, { name: '@ogygia/rewrite' });
		const wrapped = event_of(new Request('http://x/a'));
		const res = await same({ event: wrapped, resolve: ok });
		expect(await res.text()).toBe('ok');
		expect(server.pass!(wrapped)).toBeDefined();
		expect(server.pass!(event_of(new Request('http://x/a')))).toBeUndefined();
	});

	it('several in sequence share one pass, in the order they ran', async () => {
		startPlugin(server, { name: '@ogygia/rewrite' });
		const event = event_of(new Request('http://x/'));
		const order: string[] = [];
		const named = (n: string) =>
			rewrite({
				match: ['x-a'],
				render: (els) => {
					order.push(n);
					return els.map((e) => e.html);
				}
			});
		await named('one')({ event, resolve: (e) => named('two')({ event: e, resolve: ok }) });
		await server.pass!(event)!.region('<x-a></x-a>');
		expect(order).toEqual(['one', 'two']);
	});

	it('listed after ogygia.handle() is refused with rewrite_after_ogygia', () => {
		startPlugin(server, { name: '@ogygia/rewrite' });
		const event = event_of(new Request('http://x/'));
		server.request!({ event } as never);
		expect(() => same({ event, resolve: ok })).toThrow(/rewrite_after_ogygia/);
	});
});

describe("core's handle", () => {
	it('refuses `transform`, pointing at @ogygia/rewrite', () => {
		const old = { transform: (html: string) => html } as Parameters<typeof ogygia_handle>[0];
		expect(() => ogygia_handle(old)).toThrow(/handle_transform_moved/);
	});
});
