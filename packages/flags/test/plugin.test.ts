/**
 * The flags plugin: its manifest, its server realm's two hooks, and the facts a read reports.
 */
import { describe, it, expect } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { flags } from '../src/vite.ts';
import server from '../src/server.ts';
import { decide, flag } from '../src/index.ts';

const { app, ctx } = startPlugin(server, { name: '@ogygia/flags' });

describe('flags()', () => {
	it('is named by its package and names its server realm, the module beside it', () => {
		const plugin = flags();
		expect(plugin.name).toBe('@ogygia/flags');
		const manifest = (plugin as unknown as Record<symbol, Record<string, unknown>>)[
			Symbol.for('ogygia.plugin')
		];
		expect(manifest).toMatchObject({
			name: '@ogygia/flags',
			server: new URL('../src/server.ts', import.meta.url).href
		});
		// and it names flag() as its definer (a build hook: core marks each call with its module's run)
		const definers: unknown[] = [];
		const prescans: { imports: readonly string[] }[] = [];
		(manifest!.build as (b: unknown) => void)({
			root: '/app',
			definers: (module: string, names: string[]) => definers.push({ module, names }),
			prescan: (hook: { imports: readonly string[] }) => prescans.push(hook)
		});
		expect(definers).toEqual([{ module: '@ogygia/flags', names: ['flag'] }]);
		// and it reads the modules importing the package (the flag inventory)
		expect(prescans.map((h) => h.imports)).toEqual([['@ogygia/flags']]);
	});
});

describe('the server realm', () => {
	it('primes the source in `request`, done before the page reads a flag, and drains exposures in `done`', async () => {
		const sent: unknown[][] = [];
		const gate = flag('plugin-test-gate');
		decide({
			source: async () => {
				await new Promise((r) => setTimeout(r, 5));
				return { 'plugin-test-gate': true };
			},
			exposure: (b) => void sent.push(b),
			batch: { max: 100, ms: 60_000 }
		});
		try {
			const request = new Request('http://x/');
			const c = ctx(request);
			await server.request!(c);
			expect(gate({ request, url: new URL(request.url) })).toBe(true);
			server.done!(c);
			expect(sent.flat().some((e) => (e as { name: string }).name === 'plugin-test-gate')).toBe(
				true
			);
		} finally {
			decide({ source: undefined, exposure: undefined });
		}
	});
});

describe('the server realm primes the source with the visitor', () => {
	it("the event's og-vid cookie reaches the source as `c.visitor`", async () => {
		const seen: unknown[] = [];
		flag('plugin-test-visitor');
		decide({ source: (_q, c) => (seen.push(c.visitor), {}) });
		try {
			const request = new Request('http://x/');
			const cookies = {
				get: (n: string) => (n === 'og-vid' ? 'v-9' : undefined),
				getAll: () => []
			};
			await server.request!(ctx(request, { cookies } as never));
			expect(seen).toEqual([{ vid: 'v-9', anonymous: true }]);
		} finally {
			decide({ source: undefined });
		}
	});
});

describe('facts a read reports', () => {
	it('a read is a per-visitor read (a stored page never keeps one variant) and an assignment', () => {
		const hero = flag('plugin-test-hero', { a: 1, b: 1 });
		const request = new Request('http://x/');
		const variant = hero({ request, url: new URL('http://x/') });
		expect(app.facts(request).reads.perVisitor).toBe('flag:plugin-test-hero');
		expect(app.facts(request).assignments).toEqual({ 'plugin-test-hero': variant });
	});
});
