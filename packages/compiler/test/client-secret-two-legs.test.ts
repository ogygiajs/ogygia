// SECRET-SPLIT ACROSS TWO PLUGIN INSTANCES. Kit 2 loads the Vite config once per leg, so the server
// leg and the client leg each run their own `ogygia()`. Without `OGYGIA_SECRET` the signing key is a
// per-build random that only the server leg's instance holds; the client leg's check of its finished
// bundle (`refuse_client_secrets`) must look for THAT key, which reaches it through the server leg's
// handoff file, not for a random of its own that appears nowhere.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { Plugin } from 'vite';
import { ogygia } from '../src/vite/index.ts';

type Hook<T> = T | { handler: T };
const handler = <T>(hook: Hook<T>): T =>
	typeof hook === 'object' && hook !== null && 'handler' in (hook as object)
		? (hook as { handler: T }).handler
		: (hook as T);

let root = '';
afterEach(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

/** One leg's own `ogygia()`, configured for a build of `root`. */
function leg_plugin(ssr: boolean): Plugin {
	const plugin = ogygia().find((p) => p.name === 'ogygia')!;
	expect(
		handler(plugin.configResolved!).call(
			null as never,
			{
				root,
				base: '/',
				command: 'build',
				mode: 'production',
				envDir: false,
				build: { ssr }
			} as never
		),
		'configResolved runs at once'
	).toBeUndefined();
	return plugin;
}

const env = (name: 'ssr' | 'client') => ({
	environment: { name, config: { consumer: name === 'ssr' ? 'server' : 'client' } },
	emitFile: () => 'ref',
	error: (e: unknown) => {
		throw e;
	}
});

test("a client chunk holding the server leg's per-build key fails the build, with one plugin instance per leg", async () => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-two-legs-')));
	mkdirSync(path.join(root, 'src/routes'), { recursive: true });
	writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }));
	writeFileSync(path.join(root, 'src/routes/+page.svelte'), '<h1>page</h1>\n');
	const had = process.env.OGYGIA_SECRET;
	delete process.env.OGYGIA_SECRET; // the default: a per-build random key
	try {
		// the server leg: its key, baked into the server bundle; then its handoff to the client leg
		const server = leg_plugin(true);
		await handler(server.buildStart!).call(env('ssr') as never, {} as never);
		const secret_module = (await handler(server.load!).call(
			env('ssr') as never,
			'\0ogygia:server/secret',
			{ ssr: true }
		)) as string | { code: string };
		const code = typeof secret_module === 'string' ? secret_module : secret_module.code;
		const key = /"([0-9a-f]{64})"/.exec(code)?.[1];
		expect(key).toBeDefined();
		await handler(server.buildEnd!).call(env('ssr') as never);

		// the client leg: its own instance; a chunk that somehow holds the server's key
		const client = leg_plugin(false);
		await handler(client.buildStart!).call(env('client') as never, {} as never);
		const bundle = {
			'x.js': {
				type: 'chunk',
				fileName: '_app/immutable/chunks/x.js',
				code: `export const k = "${key}";`,
				moduleIds: [path.join(root, 'src/lib/x.ts')]
			}
		};
		await expect(
			handler(client.writeBundle!).call(env('client') as never, {} as never, bundle as never)
		).rejects.toThrow(/secret_in_client_chunk/);
	} finally {
		if (had === undefined) delete process.env.OGYGIA_SECRET;
		else process.env.OGYGIA_SECRET = had;
	}
});
