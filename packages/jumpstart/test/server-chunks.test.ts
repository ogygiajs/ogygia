import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfigEnv, Plugin } from 'vite';
import { Options } from '../src/options.ts';
import { ServerChunks, SERVER_CHUNK } from '../src/server-chunks.ts';

const seam = (hosts: Record<string, string[]>) => ({
	hosts: () => new Map(Object.entries(hosts).map(([h, ids]) => [h, new Set(ids)]))
});

type Hook = (name: string, config: object, env: ConfigEnv) => unknown;
const configEnvironment = (p: Plugin) => p.configEnvironment as unknown as Hook;
const BUILD: ConfigEnv = { command: 'build', mode: 'production' };
const SERVE: ConfigEnv = { command: 'serve', mode: 'development' };

function app_root(): string {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-chunks-')));
	fs.writeFileSync(path.join(dir, 'package.json'), '{}');
	return dir;
}

describe('the server chunks', () => {
	it('only the server environment of a build is shaped: the client build and dev get nothing', () => {
		const p = new ServerChunks(new Options({ external: ['sharp'] })).plugin();
		expect(configEnvironment(p)('client', {}, BUILD)).toBeUndefined();
		expect(configEnvironment(p)('ssr', {}, SERVE)).toBeUndefined();
		const ssr = configEnvironment(p)('ssr', {}, BUILD) as {
			resolve: object;
			build: {
				rolldownOptions: {
					output: {
						codeSplitting: { groups: { name: unknown; priority: number }[] };
						strictExecutionOrder?: boolean;
					};
				};
			};
		};
		expect(ssr.resolve).toEqual({ noExternal: true, external: ['sharp'] });
		const output = ssr.build.rolldownOptions.output;
		expect(output.strictExecutionOrder).toBeUndefined();
		expect(
			output.codeSplitting.groups.map((g) => [
				typeof g.name === 'string' ? g.name : 'per registry',
				g.priority
			])
		).toEqual([
			[SERVER_CHUNK, 3],
			['shared', 2],
			['per registry', 1]
		]);
	});

	it('a dependency goes in the framework chunk, unless a region is built from it', () => {
		const root = app_root();
		const chunks = new ServerChunks(new Options());
		chunks.root(root);
		chunks.attach(
			seam({ '/x/node_modules/blocks/registry.js': ['/x/node_modules/blocks/A.svelte'] })
		);
		expect(chunks.framework('/x/node_modules/svelte/src/index.js')).toBe(true);
		expect(chunks.framework('\0/x/node_modules/svelte/src/index.js?commonjs')).toBe(true);
		expect(chunks.framework(`${root}/src/lib/util.js`)).toBe(false);
		expect(chunks.framework('/x/node_modules/blocks/A.svelte')).toBe(false);
		expect(chunks.framework('/x/node_modules/blocks/registry.js')).toBe(false);
		expect(chunks.region('/x/node_modules/blocks/A.svelte')).toBe('regions-registry');
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('the external report skips the build’s own chunks and Node’s modules', () => {
		const chunks = new ServerChunks(new Options({ external: ['sharp'] }));
		const bundle = {
			'chunks/server.js': {
				type: 'chunk' as const,
				imports: ['node:fs', 'sharp', 'chunks/regions-registry.js'],
				dynamicImports: ['pg/native']
			},
			'chunks/regions-registry.js': { type: 'chunk' as const, imports: ['chunks/server.js'] },
			'x.css': { type: 'asset' as const }
		};
		expect(Object.fromEntries(chunks.externals(bundle, ['pg']).found)).toEqual({
			sharp: 'jumpstart',
			pg: 'config'
		});
		expect(Object.fromEntries(chunks.externals(bundle, true).found)).toEqual({
			sharp: 'jumpstart',
			pg: 'vite'
		});
	});

	it('the built graph is read into the shared chunk', () => {
		const root = app_root();
		const chunks = new ServerChunks(new Options());
		chunks.root(root);
		chunks.attach(seam({ [`${root}/src/registry.ts`]: [`${root}/src/A.svelte`] }));
		const info: Record<string, { isEntry: boolean; importedIds: string[] }> = {
			[`${root}/src/page.svelte`]: {
				isEntry: true,
				importedIds: [`${root}/src/util.js`, `${root}/src/registry.ts`]
			},
			[`${root}/src/registry.ts`]: { isEntry: false, importedIds: [`${root}/src/A.svelte`] },
			[`${root}/src/A.svelte`]: { isEntry: false, importedIds: [`${root}/src/util.js`] },
			[`${root}/src/util.js`]: { isEntry: false, importedIds: [] }
		};
		chunks.graph(Object.keys(info), (id) => info[id] ?? null);
		expect(chunks.shared(`${root}/src/util.js`)).toBe(true);
		expect(chunks.shared(`${root}/src/A.svelte`)).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});
});
