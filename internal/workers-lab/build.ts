/** Builds the lab server (and the worker chunk its `run: 'worker'` import emits) into dist/. */
import { readFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { build, type Plugin } from 'rolldown';
import { compile } from 'svelte/compiler';
import { run_worker } from './run-worker-plugin.ts';

const root = new URL('.', import.meta.url);

/** Svelte's server output, the way Kit's SSR build compiles a component. */
const svelte_server: Plugin = {
	name: 'ogygia-lab:svelte-server',
	async load(id) {
		if (!id.endsWith('.svelte')) return null;
		const source = await readFile(id, 'utf8');
		const out = compile(source, { filename: id, generate: 'server', css: 'external', dev: false });
		return { code: out.js.code, map: out.js.map, moduleType: 'js' };
	}
};

await rm(new URL('dist', root), { recursive: true, force: true });
const started = performance.now();
const result = await build({
	input: {
		server: new URL('src/server.ts', root).pathname,
		check: new URL('src/check.ts', root).pathname
	},
	platform: 'node',
	external: [/^node:/, 'shiki', /^shiki\//, /^svelte($|\/)/],
	plugins: [svelte_server, run_worker()],
	output: { dir: new URL('dist', root).pathname, format: 'esm' },
	write: true
});
const files = (Array.isArray(result) ? result : [result]).flatMap((r) =>
	r.output.map((o) => o.fileName)
);
console.log('built in ' + Math.round(performance.now() - started) + ' ms: ' + files.join(', '));
