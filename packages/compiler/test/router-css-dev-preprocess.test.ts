// DEV ROUTER CSS IS THE BUILD'S CSS. A server-router page component's scoped CSS is compiled one way
// in every leg: preprocessed by the plugin (`<style lang="scss">` to CSS, TypeScript stripped), then
// compiled with its script. The dev registry (`ogygia:server/router-css`) compiled the raw file: a
// scss rule came out unscoped or not at all, so dev showed a page the build would not.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { compileFoucScopedCss } from '../src/compiler/fouc-css.ts';
import { preprocess_component_for_css } from '../src/vite/style-preprocess.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const own = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const PAGE_SPEC = '@ogygia/router';
const ROUTER_CSS = '\0ogygia:server/router-css';

let root = '';
afterEach(() => rmSync(root, { recursive: true, force: true }));
const write = (rel: string, text: string) => {
	mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
	writeFileSync(path.join(root, rel), text);
};

const ABOUT = dedent`
	<script lang="ts">
		let label: string = 'about';
	</script>
	<nav class="menu"><a class="item">{label}</a></nav>
	<style lang="scss">
		.menu {
			.item { color: rebeccapurple; }
		}
	</style>
`;

test("a router page's scss component: dev's router CSS is what the build compiles", async () => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-rcss-pre-')));
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	mkdirSync(path.join(root, 'node_modules'));
	symlinkSync(
		realpathSync(own('../node_modules/sass-embedded')),
		path.join(root, 'node_modules', 'sass-embedded')
	);
	write('src/routes/+page.svelte', '<h1>page</h1>\n');
	write('src/lib/About.svelte', ABOUT);
	write(
		'src/lib/pages.ts',
		dedent`
			import { page } from '${PAGE_SPEC}';
			import About from './About.svelte';
			export const pages = [page('/about', About)];
		`
	);
	const compiler = new Compiler(new Program({ forms: true, router: true }), {
		prof: {
			transformMs: 0,
			transformN: 0,
			transformHit: 0,
			prescanMs: 0,
			bakeMs: 0,
			bakeN: 0,
			resolveMs: 0,
			loadMs: 0
		},
		P: false,
		outHash: new Map<string, number>()
	});
	const preprocess_css = (source: string, abs: string) =>
		preprocess_component_for_css(source, abs, root);
	compiler.configure(
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				libDir: `${root}/src/lib`,
				is_dev: true,
				is_build: false,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				runtime_dir: '/nowhere/ogygia/runtime',
				app_shims: {},
				page_importers: [PAGE_SPEC],
				// the plugin's preprocessor (vite/index.ts), as the build's CSS walk uses it
				...({ preprocess_css } as object)
			})
		)
	);
	compiler.prescan();
	const out = await compiler.emit(ROUTER_CSS, { ssr: true, universalHooks: null });
	const code = typeof out === 'string' ? out : (out as { code: string }).code;

	const abs = `${root}/src/lib/About.svelte`;
	const build_css = compileFoucScopedCss(abs, await preprocess_css(ABOUT, abs), {
		keepScript: true
	});
	expect(build_css).toMatch(/\.menu\.svelte-\w+ \.item/);
	expect(code).toContain(JSON.stringify(build_css).slice(1, -1));
});
