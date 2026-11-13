import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load_kit_config } from '../src/vite/kit-dirs.ts';
import {
	default_kit_dirs,
	keep_client_dir,
	KEEP_CLIENT_DIR,
	resolve_kit_paths
} from '../src/compiler/kit.ts';
import { CompileCtx, normalize_import_keys } from '../src/compiler/index.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { islandDepsHandoffPath, island_deps_module } from '../src/compiler/link/island-deps.ts';

// ─────────────────────────────────────────────────────────────────────────────
// ogygia must follow the app's `kit.files.routes` and `kit.outDir`, not assume `src/routes` and
// `.svelte-kit`. Regression: an app that builds a second route tree from the same source
// (`CATALOG_MODE=v2` → `files.routes: 'src/routes-v2'`, `outDir: '.svelte-kit-v2'`) had its all-csr=false
// tree read as "no routes here" — no keepalive, Kit skipped its client build, the runtime chunk was
// never emitted and every island 404'd; its deps handoff landed in the OTHER tree's `.svelte-kit`.
// ─────────────────────────────────────────────────────────────────────────────

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function app(files: Record<string, string>): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'og-kit-dirs-')));
	dirs.push(root);
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(root, rel);
		mkdirSync(join(abs, '..'), { recursive: true });
		writeFileSync(abs, content);
	}
	return root;
}

const dirs_of = async (root: string, plugins?: unknown) =>
	(await load_kit_config(root, plugins)).dirs;

describe('kit.files.routes / kit.outDir', () => {
	it('reads both from svelte.config.js and resolves them against the root', async () => {
		const root = app({
			'svelte.config.js':
				"export default { kit: { files: { routes: 'src/routes-v2' }, outDir: '.svelte-kit-v2' } };"
		});
		const d = await dirs_of(root);
		expect(d).toEqual({
			routes_dir: join(root, 'src/routes-v2'),
			out_dir: join(root, '.svelte-kit-v2')
		});
		expect(keep_client_dir(d.routes_dir)).toBe(join(root, 'src/routes-v2', KEEP_CLIENT_DIR));
		expect(islandDepsHandoffPath(d.out_dir)).toBe(join(root, '.svelte-kit-v2/og-region-deps.json'));
	});

	it("off Kit's own plugin: Kit 3's options at the top (vite.config only), Kit 2's under `kit`", async () => {
		const root = app({});
		const setup = (options: object) => ({ name: 'vite-plugin-sveltekit-setup', api: { options } });
		// Kit 3: `sveltekit({ … })` is a promise of plugins, its options flat
		const kit3 = [
			{ name: 'ogygia' },
			Promise.resolve([
				{ name: 'vite-plugin-svelte:config' },
				setup({ files: { routes: 'src/r3' }, outDir: '.out3', inlineStyleThreshold: 2048 })
			])
		];
		expect(await load_kit_config(root, kit3)).toEqual({
			dirs: { routes_dir: join(root, 'src/r3'), out_dir: join(root, '.out3') },
			inline_style_threshold: 2048
		});
		// Kit 2: the svelte config, Kit's options under `kit` — preferred over the file it was read from
		const kit2_root = app({
			'svelte.config.js': "export default { kit: { files: { routes: 'src/from-file' } } };"
		});
		expect(
			await dirs_of(kit2_root, [[setup({ kit: { files: { routes: 'src/r2' }, outDir: '.out2' } })]])
		).toEqual({ routes_dir: join(kit2_root, 'src/r2'), out_dir: join(kit2_root, '.out2') });
		// no Kit plugin in the list: the file
		expect((await dirs_of(kit2_root, [{ name: 'other' }, null, false])).routes_dir).toBe(
			join(kit2_root, 'src/from-file')
		);
	});

	it('a svelte.config.js that throws as it loads: the defaults, and kit_config_unreadable says why', async () => {
		const root = app({
			'svelte.config.js': "throw new Error('config broke');\nexport default {};"
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(await load_kit_dirs(root)).toEqual({
				routes_dir: join(root, 'src/routes'),
				out_dir: join(root, '.svelte-kit')
			});
			const said = warn.mock.calls.map((c) => String(c[0]));
			expect(
				said.some((s) => s.includes('kit_config_unreadable') && s.includes('config broke'))
			).toBe(true);
		} finally {
			warn.mockRestore();
		}
	});

	it('defaults to src/routes + .svelte-kit without a config, or with a config that sets neither', async () => {
		const bare = app({});
		expect(await dirs_of(bare)).toEqual(default_kit_dirs(bare));
		expect(default_kit_dirs(bare)).toEqual({
			routes_dir: join(bare, 'src/routes'),
			out_dir: join(bare, '.svelte-kit')
		});
		const plain = app({ 'svelte.config.js': 'export default { kit: {} };' });
		expect(await dirs_of(plain)).toEqual(default_kit_dirs(plain));
	});

	it('a compile context holds the dirs it was given, and the defaults when given none', () => {
		const root = app({});
		const ctx = (kit_dirs?: { routes_dir: string; out_dir: string }) =>
			new CompileCtx(
				partial_ctx_init({
					root,
					base: '/',
					libDir: join(root, 'src/lib'),
					presets: {},
					import_keys: normalize_import_keys(undefined),
					resolve_alias: [],
					pkg_root: '/nowhere/ogygia',
					app_shims: {},
					...(kit_dirs ? { kit_dirs } : {})
				})
			);
		expect(ctx().kit_dirs).toEqual(default_kit_dirs(root));
		const given = { routes_dir: join(root, 'r'), out_dir: join(root, 'o') };
		expect(ctx(given).kit_dirs).toEqual(given);
	});

	it("Kit's inlineStyleThreshold is read for the region CSS too; none, or a value that is not a positive number, is 0", async () => {
		const at = async (v: string) =>
			(
				await load_kit_config(
					app({ 'svelte.config.js': `export default { kit: { inlineStyleThreshold: ${v} } };` })
				)
			).inline_style_threshold;
		expect(await at('4096')).toBe(4096);
		expect(await at('-1')).toBe(0);
		expect(await at('Infinity')).toBe(0);
		expect(await at("'big'")).toBe(0);
		expect((await load_kit_config(app({}))).inline_style_threshold).toBe(0);
	});

	it("the app's universal and client hooks are found as .ts or .js", () => {
		for (const ext of ['ts', 'js']) {
			const root = app({ [`src/hooks.${ext}`]: '', [`src/hooks.client.${ext}`]: '' });
			const paths = resolve_kit_paths(root);
			expect(paths.universal_hooks).toBe(join(root, `src/hooks.${ext}`));
			expect(paths.client_hooks).toBe(join(root, `src/hooks.client.${ext}`));
		}
	});

	it('the SSR deps reader falls back to the configured outDir under cwd, not `.svelte-kit`', () => {
		const src = island_deps_module(true, false, '.svelte-kit-v2');
		expect(src).toContain(`path.join(cwd, ".svelte-kit-v2", 'og-region-deps.json')`);
		expect(src).not.toContain(`'.svelte-kit'`);
		// the default stays the default
		expect(island_deps_module(true, false)).toContain(
			`path.join(cwd, ".svelte-kit", 'og-region-deps.json')`
		);
	});
});
