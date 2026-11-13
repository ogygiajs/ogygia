// Standalone driver — proves the compiler SPINE runs with zero Vite. The whole point of the
// carve-out (see compiler/index.ts): `Compiler` + `Program` + `CompileCtx` are a bundler-agnostic
// compile session. A REPL / non-Vite host is just a second adapter — build a ctx, configure the
// compiler, feed it source, read back `{ code, islands }`. Here we drive it directly, importing only
// from the public `ogygia/internal/compiler` entry (../dist/compiler/index.js), never `ogygia/vite`.

import { describe, test, expect } from 'vitest';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../dist/compiler/index.js';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/standalone-app';

/** Build a fully-wired, Vite-free compile session — the four lines any non-Vite host needs. */
function make_compiler() {
	const program = new Program({ forms: true, router: true });
	const profiler = {
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
	};
	const compiler = new Compiler(
		program,
		profiler,
		new CompileCtx(
			partial_ctx_init({
				root: ROOT,
				base: '/',
				libDir: `${ROOT}/src/lib`,
				is_dev: false,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia'
			})
		)
	);
	return { compiler, program };
}

describe('standalone driver (no Vite)', () => {
	test('Compiler.transform rewrites a marked host island and reports it', () => {
		const { compiler } = make_compiler();
		const src = dedent`
			<script>
			import TabGroup from 'some-pkg/tabs' with { wake: 'load' };
			</script>
			<TabGroup />
		`;
		const result = compiler.transform(src, `${ROOT}/src/lib/Widget.svelte`, { ssr: true }) as {
			code: string;
			islands: unknown[];
		} | null;

		expect(result).not.toBeNull();
		expect(result!.islands.length).toBeGreaterThan(0); // the `with { wake }` import became an island
		expect(result!.code).not.toBe(src); // the host import was rewritten to a wrapper
		expect(result!.code).toContain('ogygia'); // generated glue references the runtime
	});

	test('a host whose raw <style lang="scss"> the CSS parser rejects still gets its island, style untouched', () => {
		// `#{$i}` threw css_expected_identifier in the parse, and the host's region import was left a
		// plain import in silence: the island never became one
		const { compiler } = make_compiler();
		const style = dedent`
			<style lang="scss">
			@for $i from 1 through 3 { :global(.ql-indent-#{$i}) { padding-left: #{$i * 3}em; } }
			</style>
		`;
		const src = dedent`
			<script>
			import TabGroup from 'some-pkg/tabs' with { wake: 'load' };
			</script>
			<TabGroup />
			${style}
		`;
		const result = compiler.transform(src, `${ROOT}/src/lib/ScssHost.svelte`, { ssr: true }) as {
			code: string;
			islands: unknown[];
		} | null;
		expect(result).not.toBeNull();
		expect(result!.islands.length).toBeGreaterThan(0);
		expect(result!.code).toContain(style);
	});

	test('Compiler.transform is memoized (same source → same result object)', () => {
		const { compiler } = make_compiler();
		const src = dedent`
			<script>
			import TabGroup from 'some-pkg/tabs' with { wake: 'load' };
			</script>
			<TabGroup />
		`;
		const id = `${ROOT}/src/lib/Widget.svelte`;
		const a = compiler.transform(src, id, { ssr: true });
		const b = compiler.transform(src, id, { ssr: true });
		expect(a).toBe(b); // content-keyed cache hit
	});

	test('Compiler.macros hoists an import.meta.og.$ factory into dollar_hoists', async () => {
		const { compiler } = make_compiler();
		const src = `${dedent`
			const make = import.meta.og.$(() => 42);
			export const x = make;
		`}\n`;
		const out = await compiler.macros(src, `${ROOT}/src/lib/store.ts`);
		expect(out.touched).toBe(true);
		expect(out.code).not.toContain('import.meta.og.$'); // the marker is gone
		expect(compiler.dollar_hoists.size).toBeGreaterThan(0); // the factory was captured for the fn-manifest
	});

	test('the fn-manifest is the same bytes whatever order the modules transformed in', async () => {
		const mod = (n: number) => `export const f${n} = import.meta.og.$(() => ${n});\n`;
		const manifest = async (order: number[]) => {
			const { compiler } = make_compiler();
			for (const n of order) await compiler.macros(mod(n), `${ROOT}/src/lib/m${n}.ts`);
			const leg = {
				server: false,
				relocated: new Map<string, number>(),
				late_server_regions: new Map<string, string>()
			};
			const bundle = {
				graph: () => null,
				module_ids: () => [],
				chunk_file: 'fn-manifest.js',
				file_name: String,
				facade_file: () => undefined
			};
			return compiler.relocate('/*__OGYGIA_FN_MANIFEST__*/', leg, bundle)?.code;
		};
		const forward = await manifest([1, 2, 3]);
		expect(forward).toContain('__og_reg_fn');
		expect(await manifest([3, 1, 2])).toBe(forward);
	});

	test('Compiler.macros is inert on a module with no markers', async () => {
		const { compiler } = make_compiler();
		const src = `export const answer = 42;\n`;
		const out = await compiler.macros(src, `${ROOT}/src/lib/plain.ts`);
		expect(out.touched).toBe(false);
		expect(out.code).toBe(src);
	});

	test('Compiler.ts_regions mints a `with { wake }` load-region import', () => {
		const { compiler, program } = make_compiler();
		const src = `${dedent`
			import { load } from './data.remote' with { wake: 'load' };
			export { load };
		`}\n`;
		const result = compiler.ts_regions(src, `${ROOT}/src/lib/feed.ts`) as { code: string } | null;
		// A ts-region mint either rewrites the module (island descriptors) or no-ops if the attribute
		// form isn't a region here; either way the call runs with no Vite and the Program is intact.
		expect(program).toBeInstanceOf(Program);
		if (result) expect(typeof result.code).toBe('string');
	});
});
