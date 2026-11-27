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
import * as devalue from 'devalue';
import { dedent } from '@ogygia/core/contract';
import { clientBuildWillSkip, resolve_kit_paths, route_reader } from '../../src/kit.ts';
import {
	KIT_PATCHES,
	KIT_PUBLIC_ENV_CLIENT_RE,
	kit_env_dynamic,
	kit_public_env_module
} from '../../src/kit-patches.ts';
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

const PATCHES: Internal = {
	upstream: "SvelteKit's generated browser modules (its client app, Kit 3's `$app/env/public`)",
	used_by: ['packages/compiler/src/kit-patches.ts (KIT_PATCHES)'],
	issue: 2177
};
const PUBLIC_ENV: Internal = {
	upstream: "SvelteKit 3's rendered public env (`rendered_env`, what its payload sends as `env`)",
	used_by: [
		'packages/compiler/src/kit-patches.ts (kit_public_env_module, kit_env_dynamic)',
		'packages/core/src/server/env-seed.ts (env_seed_script)'
	],
	issue: 2177
};

const KIT_DIRS = path.join(import.meta.dirname, '../../src/vite/kit-dirs.ts');
const DEVALUE_TEXT = path.join(import.meta.dirname, '../../../core/src/server/devalue-text.ts');

/** The CSS a page links, read back from the build's client output. */
function linked_css(app: KitApp, html: string): string {
	return [...html.matchAll(/<link href="\.\/([^"]+\.css)" rel="stylesheet"/g)]
		.map((m) => fs.readFileSync(path.join(app.out_dir, 'output/client', m[1]!), 'utf8'))
		.join('\n');
}

const has_client_entry = (app: KitApp) =>
	fs.existsSync(path.join(app.out_dir, 'output/client', APP_DIR, 'immutable/entry'));

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const REGION_DEFAULT = 'canary region';
const PRIVATE_DEFAULT = 'canary private value';
const STATIC_DEFAULT = 'canary static value';

/** Kit 3 only: a dynamic public variable (`src/env.js`) and a csr=true page that reads it, so Kit
 *  sends its public env in its payload there. */
function with_public_env(app: KitApp): KitApp {
	if (app.major < 3) return app;
	fs.writeFileSync(
		path.join(app.dir, 'src/env.js'),
		dedent`
			import { defineEnvVars } from '@sveltejs/kit/env';
			export const variables = defineEnvVars({
				PUBLIC_REGION: { public: true, static: false, schema: (v) => v ?? ${JSON.stringify(REGION_DEFAULT)} },
				SECRET_TOKEN: { public: false, static: false, schema: (v) => v ?? ${JSON.stringify(PRIVATE_DEFAULT)} },
				PUBLIC_BUILT_IN: { public: true, static: true, schema: (v) => v ?? ${JSON.stringify(STATIC_DEFAULT)} }
			});
		`
	);
	fs.mkdirSync(path.join(app.dir, 'src/pages/env'), { recursive: true });
	fs.writeFileSync(
		path.join(app.dir, 'src/pages/env/+page.svelte'),
		dedent`
			<script>
				import { PUBLIC_REGION } from '$app/env/public';
			</script>
			<p data-region>{PUBLIC_REGION}</p>
		`
	);
	fs.writeFileSync(
		path.join(app.dir, 'src/lib/kit-env.js'),
		kit_public_env_module(app.major, { kind: 'fixed', id: 'canary-build' })
	);
	app.export_from('kit_public_env', './kit-env.js');
	app.export_from('kit_env_build', './kit-env.js');
	app.export_from('devalue_text', DEVALUE_TEXT);
	fs.mkdirSync(path.join(app.dir, 'src/pages/env-channel'), { recursive: true });
	fs.writeFileSync(
		path.join(app.dir, 'src/pages/env-channel/+server.js'),
		dedent`
			import { devalue_text, kit_env_build, kit_public_env } from '$lib/ogygia';
			export const GET = () => {
				const env = kit_public_env();
				return Response.json({ env, channel: devalue_text({ build: kit_env_build(), env }, {}) });
			};
		`
	);
	return app;
}

/** ogygia's server module as the app's Kit serves it: Kit's rendered env, and the channel text
 *  core's env seed writes from it (server/env-seed.ts). */
async function ogygia_env(app: KitApp): Promise<{ env: Record<string, unknown>; channel: string }> {
	return (await fetch(new URL('/env-channel', app.url))).json() as Promise<{
		env: Record<string, unknown>;
		channel: string;
	}>;
}

/** Each row of the patch table whose module this Kit generates for `mode` finds Kit's text where
 *  it reads it, in the module Kit wrote. */
function expect_patches_apply(app: KitApp, mode: 'dev' | 'build'): void {
	const dir = path.join(app.out_dir, 'generated');
	const files = (fs.readdirSync(dir, { recursive: true }) as string[])
		.map((f) => path.join(dir, f).split(path.sep).join('/'))
		.filter((f) => !f.includes(`/generated/${mode === 'dev' ? 'build' : 'dev'}/`));
	const rows = KIT_PATCHES.filter(
		(row) => row.kits.includes(app.major) && (row.mode ?? mode) === mode
	);
	expect(rows.length).toBeGreaterThan(0);
	for (const row of rows) {
		const file = files.find((f) => row.id.test(f));
		expect(file, broke(PATCHES, `Kit generated no module for "${row.name}"`)).toBeDefined();
		const code = fs.readFileSync(file!, 'utf8');
		const patched = row.patch(code, file!);
		expect(
			patched,
			broke(PATCHES, `"${row.name}" finds nothing to patch in ${file}:\n${code}`)
		).not.toBeNull();
		if (KIT_PUBLIC_ENV_CLIENT_RE.test(file!))
			expect(
				patched,
				broke(PATCHES, `"${row.name}" does not see the app's dynamic variable in ${file}:\n${code}`)
			).toContain(`from 'ogygia:boot/kit-env'`);
	}
}

/** Kit's env config for `mode` sets the app's dynamic public variable where the compiler looks for
 *  one before it makes the build's identity. */
function expect_dynamic_env_seen(app: KitApp, mode: 'dev' | 'build'): void {
	const config = path.join(app.out_dir, 'generated', mode, 'env', 'config.js');
	expect(
		kit_env_dynamic({ out_dir: app.out_dir, mode, fs: node_fs }),
		broke(PUBLIC_ENV, `the compiler sees no dynamic public variable in ${config}`)
	).toBe(true);
	expect(fs.readFileSync(config, 'utf8')).toContain('rendered_env.PUBLIC_REGION =');
}

/** Kit's rendered public env holds no private variable and no static one. */
function expect_no_private_or_static(env: string | Record<string, unknown> | undefined): void {
	const text = typeof env === 'string' ? env : JSON.stringify(env);
	for (const [name, value] of [
		['SECRET_TOKEN', PRIVATE_DEFAULT],
		['PUBLIC_BUILT_IN', STATIC_DEFAULT]
	])
		expect(text, broke(PUBLIC_ENV, `Kit's rendered public env holds ${name}`)).not.toContain(value);
}

/** What Kit 3 puts in its payload as `env` on a csr=true page, read from the page. */
async function payload_env(app: KitApp): Promise<string | undefined> {
	const html = await app.text('/env');
	return /\benv:\s*(\{[^}]*\})/.exec(html)?.[1];
}

describe.each(Object.entries(KITS))('%s', (_, root) => {
	describe('served from dev', () => {
		const app = with_public_env(new KitApp(root, 'dev'));
		beforeAll(() => app.start());
		afterAll(() => app.stop());

		it('generates every module the patch table patches, in the text each row reads', () => {
			expect_patches_apply(app, 'dev');
		});

		it.skipIf(app.major < 3)(
			'sets its dynamic public variable in its env config, where the compiler looks before it hashes the source',
			() => {
				expect_dynamic_env_seen(app, 'dev');
			}
		);

		it.skipIf(app.major < 3)(
			"sends its rendered public env in a csr=true page's payload, as the server's channel does",
			async () => {
				const env = await payload_env(app);
				expect_no_private_or_static(env);
				expect(env, broke(PUBLIC_ENV, "Kit's payload env is not its rendered public env")).toBe(
					devalue.uneval({ PUBLIC_REGION: REGION_DEFAULT })
				);
			}
		);

		it.skipIf(app.major < 3)(
			"ogygia's server module renders Kit's public env in dev, and its channel holds no private or static variable",
			async () => {
				const { env, channel } = await ogygia_env(app);
				expect_no_private_or_static(env);
				expect_no_private_or_static(channel);
				expect(env, broke(PUBLIC_ENV, 'the dev server module renders another env')).toEqual({
					PUBLIC_REGION: REGION_DEFAULT
				});
				expect(devalue.parse(channel)).toEqual({
					build: 'canary-build',
					env: { PUBLIC_REGION: REGION_DEFAULT }
				});
			}
		);

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
		const app = with_public_env(new KitApp(root, 'build'));
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

		it('generates every module the patch table patches, in the text each row reads (build)', () => {
			expect_patches_apply(app, 'build');
		});

		it.skipIf(app.major < 3)(
			'sets its dynamic public variable in its env config, where the compiler looks before it hashes the source (build)',
			() => {
				expect_dynamic_env_seen(app, 'build');
			}
		);

		it.skipIf(app.major < 3)(
			"sends its server module's rendered_env as a csr=true page's payload env",
			async () => {
				const rendered = JSON.parse(
					await app.node(`
					const config = await import(${JSON.stringify(path.join(app.out_dir, 'generated/build/env/config.js'))});
					config.set_env({});
					console.log(JSON.stringify(config.rendered_env));
				`)
				) as Record<string, unknown>;
				expect_no_private_or_static(rendered);
				expect(rendered, broke(PUBLIC_ENV, 'the server module renders another env')).toEqual({
					PUBLIC_REGION: REGION_DEFAULT
				});
				expect(
					await payload_env(app),
					broke(PUBLIC_ENV, "Kit's payload env is not its rendered public env")
				).toBe(devalue.uneval(rendered));
			}
		);

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
