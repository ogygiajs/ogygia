import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load_kit_dirs } from '../src/vite/kit-dirs.ts';
import {
	kit_dirs,
	set_kit_dirs,
	kit_inline_style_threshold,
	set_kit_inline_style_threshold,
	keep_client_dir,
	KEEP_CLIENT_DIR,
	resolve_kit_paths
} from '../src/compiler/kit.ts';
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

describe('kit.files.routes / kit.outDir', () => {
	it('reads both from svelte.config.js and resolves them against the root', async () => {
		const root = app({
			'svelte.config.js':
				"export default { kit: { files: { routes: 'src/routes-v2' }, outDir: '.svelte-kit-v2' } };"
		});
		const d = await load_kit_dirs(root);
		expect(d).toEqual({
			routes_dir: join(root, 'src/routes-v2'),
			out_dir: join(root, '.svelte-kit-v2')
		});
		// cached for the compiler (sync) …
		expect(kit_dirs(root)).toEqual(d);
		// … and every path-derived helper follows it
		expect(keep_client_dir(root)).toBe(join(root, 'src/routes-v2', KEEP_CLIENT_DIR));
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
		expect(await load_kit_dirs(root, kit3)).toEqual({
			routes_dir: join(root, 'src/r3'),
			out_dir: join(root, '.out3')
		});
		// Kit 2: the svelte config, Kit's options under `kit` — preferred over the file it was read from
		const kit2_root = app({
			'svelte.config.js': "export default { kit: { files: { routes: 'src/from-file' } } };"
		});
		expect(
			await load_kit_dirs(kit2_root, [
				[setup({ kit: { files: { routes: 'src/r2' }, outDir: '.out2' } })]
			])
		).toEqual({ routes_dir: join(kit2_root, 'src/r2'), out_dir: join(kit2_root, '.out2') });
		// no Kit plugin in the list: the file
		expect((await load_kit_dirs(kit2_root, [{ name: 'other' }, null, false])).routes_dir).toBe(
			join(kit2_root, 'src/from-file')
		);
	});

	it('defaults to src/routes + .svelte-kit without a config, or with a config that sets neither', async () => {
		const bare = app({});
		expect(await load_kit_dirs(bare)).toEqual({
			routes_dir: join(bare, 'src/routes'),
			out_dir: join(bare, '.svelte-kit')
		});
		const plain = app({ 'svelte.config.js': 'export default { kit: {} };' });
		expect(await load_kit_dirs(plain)).toEqual({
			routes_dir: join(plain, 'src/routes'),
			out_dir: join(plain, '.svelte-kit')
		});
	});

	it('an unread root answers the defaults (never throws), a set root answers what was set', () => {
		const root = app({});
		expect(kit_dirs(root)).toEqual({
			routes_dir: join(root, 'src/routes'),
			out_dir: join(root, '.svelte-kit')
		});
		set_kit_dirs(root, { routes_dir: join(root, 'r'), out_dir: join(root, 'o') });
		expect(kit_dirs(root).routes_dir).toBe(join(root, 'r'));
	});

	it('an unread root inlines no region CSS, as Kit inlines none by default', () => {
		expect(kit_inline_style_threshold('/apps/never-set')).toBe(0);
	});

	it("Kit's inlineStyleThreshold is read for the region CSS too; a value that is not a positive number is 0", async () => {
		const at = async (v: string) => {
			const root = app({
				'svelte.config.js': `export default { kit: { inlineStyleThreshold: ${v} } };`
			});
			await load_kit_dirs(root);
			return kit_inline_style_threshold(root);
		};
		expect(await at('4096')).toBe(4096);
		expect(await at('-1')).toBe(0);
		expect(await at('Infinity')).toBe(0);
		expect(await at("'big'")).toBe(0);
	});

	it("the app's universal and client hooks are found as .ts or .js", () => {
		for (const ext of ['ts', 'js']) {
			const root = app({ [`src/hooks.${ext}`]: '', [`src/hooks.client.${ext}`]: '' });
			const paths = resolve_kit_paths(root);
			expect(paths.universal_hooks).toBe(join(root, `src/hooks.${ext}`));
			expect(paths.client_hooks).toBe(join(root, `src/hooks.client.${ext}`));
		}
	});

	it('a root keeps what was set however many other roots one process configures (it cannot be read again here)', () => {
		const first = '/apps/first';
		set_kit_dirs(first, { routes_dir: '/apps/first/r', out_dir: '/apps/first/o' });
		set_kit_inline_style_threshold(first, 4096);
		for (let i = 0; i < 200; i++) {
			const root = `/apps/other-${i}`;
			set_kit_dirs(root, { routes_dir: `${root}/r`, out_dir: `${root}/o` });
			set_kit_inline_style_threshold(root, 0);
		}
		expect(kit_dirs(first).routes_dir).toBe('/apps/first/r');
		expect(kit_inline_style_threshold(first)).toBe(4096);
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
