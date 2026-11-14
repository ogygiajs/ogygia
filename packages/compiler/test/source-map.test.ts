// A module the compiler rewrites in several passes maps every generated position back to the file
// as it was read (#1518): the macros, the island transform, the module-script registrations, the
// client `$app/*` shim and the server's ownership stamps each move code.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../src/index.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import type { PluginMacro } from '../src/macros/pipeline.ts';
import { dedent } from '@ogygia/core/contract';

const HOST = `${dedent`
	<script module>
		export const createCart = import.meta.og.store((seed = []) => ({ subscribe: () => {}, seed })); export const after = 'after-macro';
	</script>

	<script>
		import Counter from '$lib/Counter.svelte' with { wake: 'load' };
		const marker = 'find-me';
	</script>

	<ds-button>go</ds-button>
	<Counter />
	<p class="tail">tail</p>
`}\n`;

let root = '';

function make_compiler(macros: PluginMacro[] = []) {
	const program = new Program({ forms: true, router: true });
	const profiler = {
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
	};
	const compiler = new Compiler(
		program,
		profiler,
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				libDir: path.join(root, 'src/lib'),
				is_dev: false,
				is_build: true,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				app_shims: {},
				macros
			})
		)
	);
	return compiler;
}

/** The 1-based line and 0-based column of `needle` in `text`. */
function position_of(text: string, needle: string): { line: number; column: number } {
	const at = text.indexOf(needle);
	expect(at, needle).toBeGreaterThan(-1);
	const before = text.slice(0, at).split('\n');
	return { line: before.length, column: before[before.length - 1]!.length };
}

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-map-'));
	const write = (rel: string, src: string) => {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, src);
	};
	write('src/routes/+layout.ts', 'export const csr = false;\n');
	write('src/lib/Counter.svelte', '<button>0</button>\n');
	write('src/routes/+page.svelte', HOST);
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe('a host a macro, an island and the stamps rewrite', () => {
	for (const ssr of [true, false]) {
		test(`maps each generated position back to the source (${ssr ? 'server' : 'client'} leg)`, async () => {
			const id = path.join(root, 'src/routes/+page.svelte');
			const compiler = make_compiler();
			const env = { name: ssr ? 'ssr' : 'client', server: ssr };
			compiler.start_leg(env.name, env.server);
			const res = await compiler.transform_module(HOST, id, {
				leg: compiler.leg(env),
				emitFile: () => 'ref'
			});
			expect(res).not.toBeNull();
			expect(res!.code).not.toContain('import.meta.og.store');
			expect(res!.map).not.toBeNull();
			const map = new TraceMap(res!.map as never);
			for (const needle of [`'after-macro'`, `'find-me'`, '<p class="tail">', '<ds-button']) {
				const original = originalPositionFor(map, position_of(res!.code, needle));
				expect({ line: original.line, column: original.column }, needle).toEqual(
					position_of(HOST, needle)
				);
			}
		});
	}
});

test('a text-only plugin macro leaves a map that maps nothing, never a wrong place', async () => {
	const id = path.join(root, 'src/routes/+page.svelte');
	const grow: PluginMacro = {
		name: 'grow',
		handler: (code) => code.replace('import.meta.og.grow()', `'${'x'.repeat(40)}'`)
	};
	const src = `${dedent`
		<script>
			const a = import.meta.og.grow(); const marker = 'find-me';
		</script>
	`}\n`;
	const compiler = make_compiler([grow]);
	compiler.start_leg('ssr', true);
	const res = await compiler.transform_module(src, id, {
		leg: compiler.leg({ name: 'ssr', server: true }),
		emitFile: () => 'ref'
	});
	expect(res!.code).toContain('x'.repeat(40));
	const map = new TraceMap(res!.map as never);
	expect(originalPositionFor(map, position_of(res!.code, `'find-me'`)).line).toBeNull();
});
