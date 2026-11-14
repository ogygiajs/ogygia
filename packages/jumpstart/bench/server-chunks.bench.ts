// The work jumpstart adds to a server build: Rolldown asks each group about every module (the
// framework test, the shared test, the registry name), the built graph is walked once for the shared
// chunk, and the external report reads every chunk's imports. Sized like the research fixture: 225
// blocks, about 1,000 modules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bench } from '@bench/heisenbench/bench';
import { Options } from '../src/options.ts';
import { ServerChunks } from '../src/server-chunks.ts';

fs.mkdirSync(path.join(os.tmpdir(), 'jumpstart-bench-app'), { recursive: true });
const ROOT = fs.realpathSync(path.join(os.tmpdir(), 'jumpstart-bench-app'));
fs.writeFileSync(path.join(ROOT, 'package.json'), '{}');

/** An app of `blocks` blocks in one registry, a Svelte page marking one more, its graph and ids. */
function app(blocks: number) {
	const src = `${ROOT}/src`;
	const registry = `${src}/lib/registry.ts`;
	const block = (i: number) => `${src}/lib/blocks/B${i}.svelte`;
	const wrapper = (i: number) => `ogygia:region/wrapper/b${i}.svelte`;
	const hosts = new Map<string, Set<string>>([
		[registry, new Set(Array.from({ length: blocks }, (_, i) => [wrapper(i), block(i)]).flat())],
		[`${src}/routes/inline/+page.svelte`, new Set([`${src}/lib/Inline.svelte`])]
	]);
	const info = new Map<string, { isEntry: boolean; importedIds: string[] }>();
	const dep = (i: number) => `/x/node_modules/.pnpm/dep/node_modules/dep/f${i}.js`;
	const util = (i: number) => `${src}/lib/util/u${i}.js`;
	info.set(`${src}/routes/p/+page.svelte`, { isEntry: true, importedIds: [registry] });
	info.set(`${src}/routes/inline/+page.svelte`, {
		isEntry: true,
		importedIds: [`${src}/lib/Inline.svelte`]
	});
	info.set(`${src}/lib/Inline.svelte`, { isEntry: false, importedIds: [util(0)] });
	info.set(registry, {
		isEntry: false,
		importedIds: Array.from({ length: blocks }, (_, i) => wrapper(i))
	});
	for (let i = 0; i < blocks; i++) {
		info.set(wrapper(i), { isEntry: false, importedIds: [block(i)] });
		info.set(block(i), { isEntry: false, importedIds: [util(i % 40), dep(i % 300)] });
	}
	for (let i = 0; i < 40; i++) info.set(util(i), { isEntry: false, importedIds: [dep(i)] });
	for (let i = 0; i < 300; i++) info.set(dep(i), { isEntry: false, importedIds: [] });
	const bundle: Record<string, { type: 'chunk'; imports: string[]; dynamicImports: string[] }> = {};
	for (let i = 0; i < 250; i++)
		bundle[`chunks/c${i}.js`] = {
			type: 'chunk',
			imports: ['chunks/server.js', i % 50 === 0 ? 'sharp' : 'node:fs'],
			dynamicImports: i % 25 === 0 ? [`pg/p${i}`] : []
		};
	return { hosts, info, ids: [...info.keys()], bundle };
}

function shaped(blocks: number) {
	const a = app(blocks);
	const chunks = new ServerChunks(new Options({ external: ['sharp'] }));
	chunks.root(ROOT);
	chunks.attach({ hosts: () => a.hosts });
	return { a, chunks };
}

bench(
	'jumpstart: the groups asked about every module of a 225-block build, after the graph walk',
	({ a, chunks }) => {
		chunks.regions.reset();
		chunks.graph(a.ids, (id) => a.info.get(id) ?? null);
		let n = 0;
		for (const id of a.ids) {
			if (chunks.framework(id)) n++;
			else if (chunks.shared(id)) n++;
			else if (chunks.region(id) !== null) n++;
		}
		return n;
	},
	{
		setup: () => shaped(225),
		scale: (_ctx, k) => shaped(225 * k)
	}
);

bench(
	'jumpstart: the external report over 250 server chunks',
	({ a, chunks }) => chunks.externals(a.bundle, ['pg']).report(),
	{ setup: () => shaped(10) }
);

type Group = { name: string | ((id: string) => string | null); test?: (id: string) => boolean };

bench(
	"jumpstart: the options checked, a misspelled one refused, and Rolldown's group closures asked about every module",
	({ a, groups }) => {
		let n = new Options({ external: ['sharp', 'pg', 'sharp'] }).external.length;
		for (const bad of [{ externals: [] }, { external: [''] }])
			try {
				new Options(bad as never);
			} catch (e) {
				n += String(e).length;
			}
		for (const id of a.ids)
			for (const g of groups) {
				if (g.test?.(id)) n++;
				if (typeof g.name === 'function' && g.name(id) !== null) n++;
			}
		return n + new Options().external.length;
	},
	{
		setup: () => {
			const { a, chunks } = shaped(225);
			chunks.graph(a.ids, (id) => a.info.get(id) ?? null);
			const env = chunks.environment() as {
				build: { rolldownOptions: { output: { codeSplitting: { groups: Group[] } } } };
			};
			return { a, groups: env.build.rolldownOptions.output.codeSplitting.groups };
		}
	}
);

bench(
	'jumpstart: the report when every dependency is inside the bundle',
	({ chunks }) => chunks.externals({}, []).report(),
	{ setup: () => shaped(1) }
);
