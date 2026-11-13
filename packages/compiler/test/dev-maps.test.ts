// The dev server's maps for the profiler: Vite's module runner wraps each server module in an
// `AsyncFunction` with `"use strict";` first, so a CPU profile's lines are the module's own shifted
// by the lines in front of it. The map handed out is shifted by exactly those lines.
import { describe, expect, it } from 'vitest';
import type { ViteDevServer } from 'vite';
import {
	DEV_MAPS,
	DEV_PAGE_KEYS,
	install_dev_maps,
	install_dev_page_keys,
	type DevPageKeys
} from '../src/vite/dev-maps.ts';
import type { PageReads, PageReadsResolve } from '../src/vite/plugin-api.ts';

describe('install_dev_maps', () => {
	it("a module's map is shifted by the runner's lines in front of its first line", () => {
		const server = {
			environments: {
				ssr: {
					moduleGraph: {
						getModuleById: (id: string) =>
							id === '/app/a.ts'
								? { transformResult: { map: { version: 3, mappings: 'AAAA' } } }
								: undefined
					}
				}
			}
		} as unknown as ViteDevServer;
		install_dev_maps(server);
		const get = (globalThis as Record<symbol, unknown>)[DEV_MAPS] as (
			id: string
		) => string | undefined;
		const AsyncFunction = async function () {}.constructor as new (...a: string[]) => () => unknown;
		const src = new AsyncFunction('a', 'b', '"use strict";\n/*code*/').toString();
		const lines_before = src.slice(0, src.indexOf('/*code*/')).split('\n').length - 1;
		const map = JSON.parse(get('/app/a.ts')!);
		expect(map.mappings).toBe(`${';'.repeat(lines_before)}AAAA`);
		expect(get('/app/none.ts')).toBeUndefined();
	});
});

describe('install_dev_page_keys', () => {
	it('a helper the dev server cannot resolve is not followed, and the island still gets its keys', async () => {
		const server = {
			environments: { ssr: { moduleGraph: { getModulesByFile: () => new Set() } } },
			pluginContainer: {
				resolveId: async (specifier: string) => {
					if (specifier === './broken.ts') throw new Error('resolve failed');
					return { id: `/app/src/${specifier.slice(2)}` };
				}
			}
		} as unknown as ViteDevServer;
		const followed: Array<{ id: string } | null | undefined> = [];
		const reads = {
			module() {},
			settle: async () => {},
			keys: () => null,
			why: () => null,
			dev: async (files: readonly string[], resolve: PageReadsResolve) => {
				followed.push(await resolve('./broken.ts', files[0]!));
				followed.push(await resolve('./ok.ts', files[0]!));
				return { keys: ['title'], why: [] };
			}
		} as unknown as PageReads;
		install_dev_page_keys(server, () => '/app/src/Island.svelte?x', '/app', reads);
		const ask = (globalThis as Record<symbol, unknown>)[DEV_PAGE_KEYS] as (
			iid: string
		) => Promise<DevPageKeys | undefined>;
		expect(await ask('island')).toEqual({ keys: ['title'], why: [] });
		expect(followed).toEqual([null, { id: '/app/src/ok.ts' }]);
	});
});
