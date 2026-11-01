/**
 * The postrender plugin as core sees it: its Vite value (name, normalized options, the `postrender`
 * key it claims inside Kit's `config`) and its server realm started the way the handle starts it —
 * the shared hooks it calls (`invalidated`) and answers (`lastBuild`).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { register_hooks, ask } from '../../core/src/plugin/hooks.ts';
import type { PluginDefinition } from '@ogygia/core/vite';
import { postrender as postrenderPlugin } from '../src/vite.ts';
import server, { type PostrenderServerOptions } from '../src/server.ts';
import { postrender } from '../src/index.ts';
import { install, reset_for_tests } from '../src/registry.ts';
import { memory_store } from '../src/memory-store.ts';

/** the definition `definePlugin` put on the Vite plugin */
const definition = (plugin: ReturnType<typeof postrenderPlugin>) =>
	(plugin as unknown as Record<symbol, PluginDefinition<PostrenderServerOptions>>)[
		Symbol.for('ogygia.plugin')
	];

// The server half reads Kit's `$app/env`; outside an app, nothing is building and this is no dev server.
vi.mock('$app/env', () => ({ building: false, dev: false }));

describe('postrender() — the vite value', () => {
	it('names the package and normalizes its options', () => {
		const plugin = postrenderPlugin();
		const options = (o?: Parameters<typeof postrenderPlugin>[0]) =>
			definition(postrenderPlugin(o)).options;
		expect(plugin.name).toBe('@ogygia/postrender');
		expect(options()).toEqual({ ttl: 86400, default: true });
		expect(options({ ttl: 999_999 })?.ttl).toBe(86400);
		expect(options({ ttl: 0 })?.ttl).toBe(1);
		expect(options({ ttl: 12.7 })?.ttl).toBe(12);
		expect(options({ default: false })?.default).toBe(false);
	});

	it('its build hook claims the `postrender` key inside Kit’s `config`', () => {
		const keys: string[] = [];
		definition(postrenderPlugin()).build!({
			root: '/',
			dev: true,
			routeConfig: (k) => void keys.push(k),
			foreignHydrate: () => {},
			macro: () => {},
			markup: () => ({ transform: () => null }),
			events: () => {},
			measure: () => {},
			files: () => {},
			pageModules: () => {}
		});
		expect(keys).toEqual(['postrender']);
	});
});

describe('the server realm, started', () => {
	const options: PostrenderServerOptions = { ttl: 60, default: true };
	startPlugin(server, { name: '@ogygia/postrender', options });
	afterEach(() => reset_for_tests());

	it('an invalidation announces what it dropped through the shared `invalidated` hook', async () => {
		const heard: (string[] | 'all')[] = [];
		const leave = register_hooks({
			invalidated: (tags: string[] | 'all') => void heard.push(tags)
		});
		try {
			await postrender.invalidate('/x');
			await postrender.invalidateWhere({ prefix: '/a/' });
			await Promise.resolve();
			expect(heard).toEqual([['p:/x'], 'all']);
		} finally {
			leave();
		}
	});

	it('answers `lastBuild`: nothing the first time, the previous build after that', async () => {
		expect(await ask.lastBuild('v1')).toBeUndefined();
		expect(await ask.lastBuild('v2')).toBe('v1');
	});

	it('remembers the build past the pages’ TTL: a deploy a month later still finds it', async () => {
		const puts: { key: string; ttl: number }[] = [];
		const store = memory_store();
		const put = store.put.bind(store);
		store.put = (key, entry, options) => {
			puts.push({ key, ttl: options.ttl });
			return put(key, entry, options);
		};
		install({ store });
		const now = vi.spyOn(Date, 'now');
		const t0 = Date.now();
		now.mockReturnValue(t0);
		try {
			expect(await ask.lastBuild('v1')).toBeUndefined();
			now.mockReturnValue(t0 + 30 * 86_400_000);
			expect(await ask.lastBuild('v1')).toBe('v1'); // the same build booting again
			now.mockReturnValue(t0 + 60 * 86_400_000);
			expect(await ask.lastBuild('v2')).toBe('v1');
			// written on every ask, never under the pages' one-day cap
			expect(puts).toHaveLength(3);
			for (const p of puts) expect(p.ttl).toBeGreaterThan(365 * 86_400);
		} finally {
			now.mockRestore();
		}
	});
});
