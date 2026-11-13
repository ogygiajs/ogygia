// The dev server's maps for the profiler: Vite's module runner wraps each server module in an
// `AsyncFunction` with `"use strict";` first, so a CPU profile's lines are the module's own shifted
// by the lines in front of it. The map handed out is shifted by exactly those lines.
import { describe, expect, it } from 'vitest';
import type { ViteDevServer } from 'vite';
import { DEV_MAPS, install_dev_maps } from '../src/vite/dev-maps.ts';

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
