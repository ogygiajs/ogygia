/**
 * CANARY (#1718, #1720): what SvelteKit's build and Vite plugin do that the compiler finds or works
 * around, asked of a real Kit app (core's test/canary/kit-app.ts) for every Kit the workspace
 * installs: where Kit's client reaches remote functions, the keys it seeds remote results under, when
 * it skips its client build, which stylesheets a csr=false page links, and the config it honours.
 * internal/notes/INVARIANTS.md (KIT-CLIENT-BUILD, KIT-CSR-FALSE-ASSETS, KIT-CONFIG) says why each
 * matters; the e2e specs it names prove the workaround on a real build.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { clientBuildWillSkip, resolve_kit_paths, route_reader } from '../../src/kit.ts';
import { node_fs } from '../../src/fs.ts';
import { APP_DIR, KitApp, OUT_DIR } from '../../../core/test/canary/kit-app.ts';
import { broke, KITS, type Internal } from '../../../core/test/canary/upstream.ts';

const REMOTE: Internal = {
	upstream: "SvelteKit's remote functions client (what a remote file's client module imports)",
	used_by: [
		'packages/compiler/src/kit.ts (kit_remote_index)',
		'packages/compiler/src/vite/index.ts (resolveId of `__sveltekit/remote`)'
	],
	issue: 1718
};
const WIRE: Internal = {
	upstream: "SvelteKit's remote key helper (`create_remote_key`, the keys of its remote seed)",
	used_by: [
		'packages/compiler/src/kit.ts (kit_wire_path)',
		'packages/core/src/hooks.ts (the remote seed)'
	],
	issue: 1718
};
const CLIENT_BUILD: Internal = {
	upstream: "SvelteKit's client-build skip (every route node csr=false)",
	used_by: [
		'packages/compiler/src/kit.ts (clientBuildWillSkip, the keep-client route)',
		'packages/compiler/src/vite/index.ts (KEEP_CLIENT_DIR)'
	],
	issue: 1720
};
const ASSETS: Internal = {
	upstream: "SvelteKit's page stylesheets (a node's whole client graph, linked on csr=false pages)",
	used_by: ['packages/compiler/src/region/emit.ts (the registry stubs of region hosts)'],
	issue: 1720
};
const CONFIG: Internal = {
	upstream:
		"SvelteKit's config options (`files.routes`, `outDir`, `appDir`, `inlineStyleThreshold`)",
	used_by: [
		'packages/compiler/src/vite/kit-dirs.ts (load_kit_config)',
		'packages/compiler/src/vite/index.ts (`__SVELTEKIT_APP_DIR__`)'
	],
	issue: 1720
};

const KIT_DIRS = path.join(import.meta.dirname, '../../src/vite/kit-dirs.ts');

/** The CSS a page links, read back from the build's client output. */
function linked_css(app: KitApp, html: string): string {
	return [...html.matchAll(/<link href="\.\/([^"]+\.css)" rel="stylesheet"/g)]
		.map((m) => fs.readFileSync(path.join(app.out_dir, 'output/client', m[1]!), 'utf8'))
		.join('\n');
}

const has_client_entry = (app: KitApp) =>
	fs.existsSync(path.join(app.out_dir, 'output/client', APP_DIR, 'immutable/entry'));

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

describe.each(Object.entries(KITS))('%s', (_, root) => {
	describe('served from dev', () => {
		const app = new KitApp(root, 'dev');
		beforeAll(() => app.start());
		afterAll(() => app.stop());

		it("a remote file's client module imports the remote functions client the compiler resolves", async () => {
			const index = resolve_kit_paths(app.dir).kit_remote_index;
			expect(index, broke(REMOTE, 'Kit has no client remote-functions index')).not.toBeNull();
			const client = await app.text('/src/lib/greet.remote.ts');
			const imported = [...client.matchAll(/from\s+"\/@fs(\/[^"?]+)/g)].map((m) =>
				fs.realpathSync(m[1]!)
			);
			expect(
				imported,
				broke(REMOTE, `the remote file's client module imports another file:\n${client}`)
			).toContain(fs.realpathSync(index!));
		});
	});

	describe('served from a build', () => {
		const app = new KitApp(root, 'build');
		beforeAll(async () => {
			app.export_from('create_remote_key', resolve_kit_paths(app.dir).kit_wire_path!);
			await app.start();
		});
		afterAll(() => app.stop());

		it('keys the remote results it seeds on a csr=true page with `create_remote_key`', async () => {
			const { html, probe } = await app.probe('/');
			const seed = probe.seed as { q: Record<string, unknown> } | null;
			const keys = Object.keys(seed?.q ?? {});
			expect(keys, broke(WIRE, 'the seed ogygia keys holds no query')).toHaveLength(1);
			expect(
				html,
				broke(WIRE, `Kit's own seed does not carry the key \`${keys[0]}\`:\n${html}`)
			).toContain(JSON.stringify(keys[0]));
		});

		it('keeps its client build while one route node is csr=true, as the compiler predicts', () => {
			expect(
				has_client_entry(app),
				broke(CLIENT_BUILD, 'no client build for a csr=true page')
			).toBe(true);
			expect(clientBuildWillSkip(route_reader(node_fs), path.join(app.dir, 'src/pages'))).toBe(
				false
			);
		});

		it("links every route node's client stylesheets on a csr=false page, rendered or not", async () => {
			const html = await app.text('/server');
			const css = linked_css(app, html);
			expect(css, broke(ASSETS, `the page links no stylesheet of its own:\n${html}`)).toMatch(
				/border:\s*1px solid/
			);
			expect(
				css,
				broke(ASSETS, 'a component the page imports but did not render has no CSS linked')
			).toMatch(/outline:\s*3px dotted/);
		});

		it('honours `files.routes`, `outDir`, `appDir` and a zero `inlineStyleThreshold`, as the compiler reads them', async () => {
			const html = await app.text('/server');
			expect(html, broke(CONFIG, '`files.routes` is not where Kit found the page')).toContain(
				'hello server'
			);
			expect(
				fs.existsSync(path.join(app.dir, OUT_DIR, 'output/server')),
				broke(CONFIG, '`outDir` is not where Kit wrote its build')
			).toBe(true);
			expect(html, broke(CONFIG, '`appDir` is not where Kit serves its assets')).toContain(
				`./${APP_DIR}/immutable/`
			);
			expect(html, broke(CONFIG, 'a zero threshold inlined a stylesheet')).not.toContain('<style');
			const read = JSON.parse(
				await app.node(`
					import { loadConfigFromFile, resolveConfig } from 'vite';
					import { load_kit_config } from ${JSON.stringify(KIT_DIRS)};
					const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' });
					const kit = await load_kit_config(process.cwd(), loaded.config.plugins);
					const resolved = await resolveConfig({}, 'build');
					console.log(JSON.stringify({ kit, app_dir: resolved.define.__SVELTEKIT_APP_DIR__ }));
				`)
			) as { kit: { dirs: { routes_dir: string; out_dir: string } }; app_dir: string };
			expect(read, broke(CONFIG, 'the compiler reads other values than Kit honours')).toEqual({
				kit: {
					dirs: {
						routes_dir: path.join(app.dir, 'src/pages'),
						out_dir: path.join(app.dir, OUT_DIR)
					},
					inline_style_threshold: 0
				},
				app_dir: JSON.stringify(APP_DIR)
			});
		});
	});

	describe('served from a build whose every route node is csr=false', () => {
		const app = new KitApp(root, 'build', {
			routes: 'all-csr-false',
			inline_style_threshold: 100_000
		});
		beforeAll(() => app.start());
		afterAll(() => app.stop());

		it('skips its client build, as the compiler predicts', () => {
			expect(
				has_client_entry(app),
				broke(CLIENT_BUILD, 'Kit built its client though every route node is csr=false')
			).toBe(false);
			expect(
				clientBuildWillSkip(route_reader(node_fs), path.join(app.dir, 'src/all-csr-false'))
			).toBe(true);
		});

		it('inlines the stylesheets under `inlineStyleThreshold`, as the compiler reads it', async () => {
			const html = await app.text('/');
			expect(html, broke(CONFIG, 'a stylesheet under the threshold was not inlined')).toMatch(
				/<style>[^<]*border:\s*1px solid/
			);
			const read = JSON.parse(
				await app.node(`
					import { loadConfigFromFile } from 'vite';
					import { load_kit_config } from ${JSON.stringify(KIT_DIRS)};
					const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' });
					console.log(JSON.stringify(await load_kit_config(process.cwd(), loaded.config.plugins)));
				`)
			) as { inline_style_threshold: number };
			expect(
				read.inline_style_threshold,
				broke(CONFIG, 'the compiler reads another threshold')
			).toBe(100_000);
		});
	});
});
