// A region two hosts share (one component, one wake mark, imported by a page and its layout) is one
// registry row. Which host that row names must not depend on which host the bundler transformed
// last: the emit gate (`island_host_loaded`), a virtual module's relative imports and dev's HMR
// invalidation all read it. Found by the compiler DST harness (internal/compiler-dst, determinism).
import { test, expect } from 'vitest';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { memory_fs } from '../src/compiler/fs.ts';
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

function registry_after(order: readonly string[]) {
	const files = memory_fs({
		[PAGE]: HOST,
		[LAYOUT]: `${HOST}\n<slot />\n`,
		[`${ROOT}/src/routes/+layout.ts`]: `export const csr = false;\n`,
		[`${ROOT}/src/lib/C0.svelte`]: `<p>C0</p>\n`
	});
	const program = new Program({ forms: true, router: true });
	const compiler = new Compiler(program, {
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
	compiler.configure(
		new CompileCtx(
			partial_ctx_init({
				root: ROOT,
				base: '/',
				libDir: `${ROOT}/src/lib`,
				is_dev: false,
				is_build: true,
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
	for (const f of order) {
		const r = compiler.transform(files.read(f)!, f, { ssr: true });
		if (r) program.register(r as Parameters<Program['register']>[0], f);
	}
	return [...program.registry].sort(([a], [b]) => (a < b ? -1 : 1));
}

test('a region a page and its layout share names the same host whichever registers last', () => {
	const a = registry_after([PAGE, LAYOUT]);
	const b = registry_after([LAYOUT, PAGE]);
	expect(a.length).toBeGreaterThan(0);
	expect(a).toEqual(b);
});
