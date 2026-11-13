/**
 * The reshape plugin: its manifest, `handle()` filing the transform under the request it wraps, the
 * server realm's `pass` for exactly those requests, and core refusing the old `handle({ transform })`.
 */
import { describe, it, expect } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { handle as ogygia_handle } from '@ogygia/core/server';
import { reshape } from '../src/vite.ts';
import server from '../src/server.ts';
import { handle } from '../src/index.ts';
import { slot } from '../src/requests.ts';

const event_of = (request: Request) => ({ request, url: new URL(request.url) }) as RequestEvent;
const ok = async () => new Response('ok');

describe('reshape()', () => {
	it('is named by its package and names its server realm, the module beside it', () => {
		const plugin = reshape();
		expect(plugin.name).toBe('@ogygia/rewrite');
		expect((plugin as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.plugin')]).toEqual({
			name: '@ogygia/rewrite',
			server: new URL('../src/server.ts', import.meta.url).href,
			client: new URL('../src/client.ts', import.meta.url).href
		});
	});
});

describe('handle(transform)', () => {
	it('refuses every request while reshape() is not in vite.config, naming the fix', () => {
		slot.live = false;
		const event = event_of(new Request('http://x/'));
		expect(() => handle((html) => html)({ event, resolve: ok })).toThrow(/reshape_plugin_missing/);
	});

	it('gives a pass to the requests it wrapped, and to no other', async () => {
		startPlugin(server, { name: '@ogygia/rewrite' });
		const wrapped = event_of(new Request('http://x/a'));
		const res = await handle((html) => html.replace('a', 'b'))({ event: wrapped, resolve: ok });
		expect(await res.text()).toBe('ok');
		expect(server.pass!(wrapped)).toBeDefined();
		expect(server.pass!(event_of(new Request('http://x/a')))).toBeUndefined();
	});

	it('runs the transform on a region answer, and inlines the restorer on a document', async () => {
		startPlugin(server, { name: '@ogygia/rewrite' });
		const event = event_of(new Request('http://x/'));
		const seen: string[] = [];
		await handle((html, { kind }) => {
			seen.push(kind);
			return html;
		})({ event, resolve: ok });
		const pass = server.pass!(event)!;
		expect(await pass.region('<p>a</p>')).toBe('<p>a</p>');
		const doc = await pass.document('<html><head></head><body><p>a</p></body></html>', {
			csr: false,
			answer: false
		});
		expect(seen).toEqual(['region', 'document']);
		expect(doc.head).toBe('');
		expect(doc.body).toMatch(/^<script data-og-restore>\(function\(\)\{var r=/);
	});
});

describe("core's handle", () => {
	it('refuses `transform`, pointing at @ogygia/rewrite', () => {
		const old = { transform: (html: string) => html } as Parameters<typeof ogygia_handle>[0];
		expect(() => ogygia_handle(old)).toThrow(/handle_transform_moved/);
	});
});
