// DEV (#1375): a route host is compiled for its route's csr (a csr=true host has its marks stripped,
// Kit hydrates it whole). When an option file changes the csr of a route while the dev server runs,
// every host it reaches is compiled again: Vite only re-runs the plugin for the file that changed.
// Before, a page that became csr=false kept its stripped marks (its regions never existed until a
// restart), and one that became csr=true kept its regions. Found by the compiler DST harness
// (internal/compiler-dst, dev matches a cold start).
import { expect, test } from 'vitest';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { memory_fs, type MemoryFs } from '../src/compiler/fs.ts';
import { csrTrueRouteIds, type FileEvent } from '../src/compiler/kit.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/csr-app';
const PAGE = `${ROOT}/src/routes/a/+page.svelte`;
const LAYOUT_OPTIONS = `${ROOT}/src/routes/+layout.ts`;
const IDLE_PAGE = dedent`
	<script>
	import C0 from '$lib/C0.svelte' with { wake: 'idle' };
	</script>
	<C0 />
`;

function dev_compiler(files: MemoryFs) {
	const program = new Program({ forms: true, router: true });
	const compiler = new Compiler(
		program,
		{
			prof: {
				transformMs: 0,
				transformN: 0,
				transformHit: 0,
				prescanMs: 0,
				macroMs: 0,
				macroN: 0,
				resolveMs: 0,
				loadMs: 0
			},
			P: false,
			outHash: new Map<string, number>()
		},
		new CompileCtx(
			partial_ctx_init({
				root: ROOT,
				base: '/',
				libDir: `${ROOT}/src/lib`,
				is_dev: true,
				is_build: false,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				app_shims: {},
				fs: files
			})
		)
	);
	compiler.prescan();
	return { compiler, program };
}

/** The plugin's `watchChange` for a file (vite/index.ts): the module ids it invalidates. */
function dev_route_change(compiler: Compiler, file: string, event: FileEvent): string[] {
	return compiler.routes_changed(file, event);
}

const transform = (compiler: Compiler, files: MemoryFs) =>
	compiler.transform_module(files.read(PAGE)!, PAGE, {
		leg: compiler.leg({ name: 'ssr', server: true }),
		emitFile: () => ''
	});

test('a page that becomes csr=false while dev runs is compiled again, with its regions', async () => {
	const files = memory_fs({ [PAGE]: IDLE_PAGE, [`${ROOT}/src/lib/C0.svelte`]: `<p>C0</p>\n` });
	const { compiler, program } = dev_compiler(files);
	await transform(compiler, files);
	expect(program.registry.size).toBe(0); // csr=true: Kit hydrates the page whole

	files.set(LAYOUT_OPTIONS, `export const csr = false;\n`);
	expect(dev_route_change(compiler, LAYOUT_OPTIONS, 'create')).toContain(PAGE);
	await transform(compiler, files);
	expect(program.registry.size).toBeGreaterThan(0);
});

test('a page that becomes csr=true while dev runs is compiled again, and lets its regions go', async () => {
	const files = memory_fs({
		[PAGE]: IDLE_PAGE,
		[LAYOUT_OPTIONS]: `export const csr = false;\n`,
		[`${ROOT}/src/lib/C0.svelte`]: `<p>C0</p>\n`
	});
	const { compiler, program } = dev_compiler(files);
	await transform(compiler, files);
	expect(program.registry.size).toBeGreaterThan(0);

	files.set(LAYOUT_OPTIONS, null);
	expect(dev_route_change(compiler, LAYOUT_OPTIONS, 'delete')).toContain(PAGE);
	await transform(compiler, files);
	expect(program.registry.size).toBe(0);
});

test('a page whose csr flips and flips back while dev runs has its regions again', async () => {
	const files = memory_fs({
		[PAGE]: IDLE_PAGE,
		[LAYOUT_OPTIONS]: `export const csr = false;\n`,
		[`${ROOT}/src/lib/C0.svelte`]: `<p>C0</p>\n`
	});
	const { compiler, program } = dev_compiler(files);
	await transform(compiler, files);
	expect(program.registry.size).toBeGreaterThan(0);

	files.set(LAYOUT_OPTIONS, null);
	expect(dev_route_change(compiler, LAYOUT_OPTIONS, 'delete')).toContain(PAGE);
	await transform(compiler, files);
	expect(program.registry.size).toBe(0);

	// back to the first world, page source unchanged: compiled again, not answered from before
	files.set(LAYOUT_OPTIONS, `export const csr = false;\n`);
	expect(dev_route_change(compiler, LAYOUT_OPTIONS, 'create')).toContain(PAGE);
	await transform(compiler, files);
	expect(program.registry.size).toBeGreaterThan(0);
});

test('a route change that leaves a host its csr compiles nothing again', async () => {
	const files = memory_fs({
		[PAGE]: IDLE_PAGE,
		[LAYOUT_OPTIONS]: `export const csr = false;\n`,
		[`${ROOT}/src/lib/C0.svelte`]: `<p>C0</p>\n`
	});
	const { compiler } = dev_compiler(files);
	await transform(compiler, files);
	files.set(`${ROOT}/src/routes/b/+page.svelte`, `<h1>b</h1>\n`);
	expect(dev_route_change(compiler, `${ROOT}/src/routes/b/+page.svelte`, 'create')).not.toContain(
		PAGE
	);
});

test('an edit that leaves every route option as it was invalidates nothing', async () => {
	const files = memory_fs({
		[PAGE]: IDLE_PAGE,
		[LAYOUT_OPTIONS]: `export const csr = false;\n`,
		[`${ROOT}/src/lib/C0.svelte`]: `<p>C0</p>\n`
	});
	const { compiler } = dev_compiler(files);
	await transform(compiler, files);
	files.set(PAGE, `${IDLE_PAGE}<p>more</p>\n`);
	expect(dev_route_change(compiler, PAGE, 'update')).toEqual([]);
	files.set(
		LAYOUT_OPTIONS,
		dedent`
			// a comment
			export const csr = false;
		`
	);
	expect(dev_route_change(compiler, LAYOUT_OPTIONS, 'update')).toEqual([]);
});

test('deleting the last route file while dev runs leaves no routes, and throws nothing', async () => {
	const layout = `${ROOT}/src/routes/+layout.svelte`;
	const files = memory_fs({
		[layout]: IDLE_PAGE,
		[LAYOUT_OPTIONS]: `export const csr = false;\n`,
		[`${ROOT}/src/lib/C0.svelte`]: `<p>C0</p>\n`
	});
	const { compiler } = dev_compiler(files);
	await compiler.transform_module(files.read(layout)!, layout, {
		leg: compiler.leg({ name: 'ssr', server: true }),
		emitFile: () => ''
	});
	files.set(LAYOUT_OPTIONS, null);
	dev_route_change(compiler, LAYOUT_OPTIONS, 'delete');
	files.set(layout, null);
	expect(() => dev_route_change(compiler, layout, 'delete')).not.toThrow();
	expect(csrTrueRouteIds(compiler.ctx.routes, `${ROOT}/src/routes`)).toEqual([]);
});
