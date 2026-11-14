// A region two hosts share (one component, one wake mark, imported by a page and its layout) is one
// registry row. Which host that row names must not depend on which host the bundler transformed
// last: the emit gate (`island_host_loaded`), a virtual module's relative imports and dev's HMR
// invalidation all read it. Found by the compiler DST harness (internal/compiler-dst, determinism).
import { test, expect } from 'vitest';
import { Compiler } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { CompileCtx } from '../src/ctx.ts';
import { normalize_import_keys } from '../src/region/transform.ts';
import { memory_fs, type MemoryFs } from '../src/fs.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/order-app';
const PAGE = `${ROOT}/src/routes/(g)/+page.svelte`;
const LAYOUT = `${ROOT}/src/routes/(g)/+layout.svelte`;
const HOST = dedent`
	<script>
	import C0 from '$lib/C0.svelte' with { wake: 'visible' };
	</script>
	<C0 />
`;

function registry_after(order: readonly string[], drop?: string) {
	const files = memory_fs({
		[PAGE]: HOST,
		[LAYOUT]: dedent`
			${HOST}
			<slot />
		`,
		[`${ROOT}/src/routes/+layout.ts`]: `export const csr = false;\n`,
		[`${ROOT}/src/lib/C0.svelte`]: `<p>C0</p>\n`
	});
	const { compiler, program } = compiler_on(files);
	compiler.prescan();
	for (const f of order) {
		const r = compiler.transform(files.read(f)!, f, { ssr: true });
		if (r) program.register(r as Parameters<Program['register']>[0], f);
	}
	if (drop) program.unregister_host(drop);
	return [...program.registry].sort(([a], [b]) => (a < b ? -1 : 1));
}

function compiler_on(files: MemoryFs, { dev = false }: { dev?: boolean } = {}) {
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
				is_dev: dev,
				is_build: !dev,
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
	return { compiler, program };
}

const hosts = (rows: ReturnType<typeof registry_after>) => new Set(rows.map(([, e]) => e.hostPath));

test('a region whose first host lets go names the host that still holds it', () => {
	// (the layout sorts first: drop it, and the page's rows must show, in either order)
	expect(hosts(registry_after([PAGE, LAYOUT], LAYOUT))).toEqual(new Set([PAGE]));
	expect(hosts(registry_after([LAYOUT, PAGE], LAYOUT))).toEqual(new Set([PAGE]));
});

test('a deleted component leaves no claim on its region: the next host to mark it names itself', async () => {
	// dev: a library component marks C2; C2 is deleted, the component stops marking it, and then a
	// page marks the new C2. The library component sorts first, so a claim it kept would win.
	const LIB_HOST = `${ROOT}/src/lib/C1.svelte`;
	const C2 = `${ROOT}/src/lib/C2.svelte`;
	const MARKS_C2 = (spec: string) => dedent`
		<script>
		import C2 from '${spec}' with { wake: 'load' };
		</script>
		<C2 />
	`;
	const files = memory_fs({
		[`${ROOT}/src/routes/+page.svelte`]: `<h1>page</h1>\n`,
		[`${ROOT}/src/routes/+page.server.ts`]: `export const csr = false;\n`,
		[LIB_HOST]: MARKS_C2('./C2.svelte'),
		[C2]: `<p>C2</p>\n`
	});
	const { compiler, program } = compiler_on(files, { dev: true });
	const save = async (file: string, text: string | null) => {
		files.set(file, text);
		// the plugin's hooks for a file event (vite/index.ts watchChange, handleHotUpdate)
		if (text === null) compiler.invalidate_for_file(file, { deleted: true, invalidate: () => {} });
		else if (compiler.is_registered_host(file))
			compiler.invalidate_for_file(file, { invalidate: () => {} });
		if (text !== null)
			await compiler.transform_module(text, file, {
				leg: compiler.leg({ name: 'ssr', server: true }),
				emitFile: () => ''
			});
	};
	compiler.prescan();
	await compiler.transform_module(files.read(LIB_HOST)!, LIB_HOST, {
		leg: compiler.leg({ name: 'ssr', server: true }),
		emitFile: () => ''
	});
	await save(C2, null);
	await save(LIB_HOST, `<p>C1</p>\n`);
	await save(C2, `<p>C2</p>\n`);
	await save(`${ROOT}/src/routes/+page.svelte`, MARKS_C2('$lib/C2.svelte'));
	const rows = [...program.registry.values()];
	expect(rows.length).toBeGreaterThan(0);
	expect(new Set(rows.map((e) => e.hostPath))).toEqual(
		new Set([`${ROOT}/src/routes/+page.svelte`])
	);
});

test('a region a page and its layout share names the same host whichever registers last', () => {
	const a = registry_after([PAGE, LAYOUT]);
	const b = registry_after([LAYOUT, PAGE]);
	expect(a.length).toBeGreaterThan(0);
	expect(a).toEqual(b);
});
