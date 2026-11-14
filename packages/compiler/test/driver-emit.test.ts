import { describe, test, expect } from 'vitest';
import { Compiler } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { CompileCtx, type CompileCtxInit } from '../src/ctx.ts';
import { normalize_import_keys, CLIENT_BINDING_STUB } from '../src/region/transform.ts';
import { FOREIGN_HYDRATE_MARK } from '../src/region/emit.ts';
import { FOUC_SCOPED_PREFIX } from '../src/fouc-css.ts';
import { memory_fs } from '../src/fs.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/emit-app';
const STUB = '/stub/client-binding.js';
const SHIM = '/shim/state.js';

function make(init: Partial<CompileCtxInit> = {}) {
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
				app_dir: '_app',
				runtime_hash: '0123456789ab',
				libDir: `${ROOT}/src/lib`,
				is_dev: false,
				is_build: true,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				app_shims: { '$app/state': SHIM },
				client_binding_stub_file: STUB,
				fs: memory_fs({}),
				...init
			})
		)
	);
	const rows = program.registry as unknown as Map<string, Record<string, unknown>>;
	return { compiler, program, rows };
}

const text = (out: unknown) =>
	typeof out === 'string' ? out : (out as { code: string } | null)?.code;
const client = { ssr: false, universalHooks: null };
const server = { ssr: true, universalHooks: null };

describe('emit: a region module per leg', () => {
	test('a region descriptor: the server leg gets the signing one, the client metadata only', () => {
		const { compiler, rows } = make();
		rows.set('ogygia:region/binding/r.js', {
			role: 'region',
			ssrSource: 'server',
			clientSource: 'client'
		});
		expect(compiler.emit('ogygia:region/binding/r.js', server)).toBe('server');
		expect(compiler.emit('ogygia:region/binding/r.js', client)).toBe('client');
	});

	test('a wrapper: the client leg takes its lazy source, the server its real one', () => {
		const { compiler, rows } = make();
		rows.set('ogygia:region/wrapper/w.svelte', {
			role: 'wrapper',
			source: 'real',
			clientSource: 'lazy'
		});
		expect(compiler.emit('ogygia:region/wrapper/w.svelte', server)).toBe('real');
		expect(compiler.emit('ogygia:region/wrapper/w.svelte', client)).toBe('lazy');
	});

	test('the foreign-hydrate exports never reach the server, and reach the client only when asked', () => {
		const src = ['export default 1;', FOREIGN_HYDRATE_MARK, 'export const foreign = 2;'].join('\n');
		const asked = make({ foreign_hydrate: true });
		asked.rows.set('ogygia:region/entry/e.js', { role: 'entry', source: src });
		expect(asked.compiler.emit('ogygia:region/entry/e.js', server)).toBe('export default 1;\n');
		expect(asked.compiler.emit('ogygia:region/entry/e.js', client)).toBe(src);
		const not = make();
		not.rows.set('ogygia:region/entry/e.js', { role: 'entry', source: src });
		expect(not.compiler.emit('ogygia:region/entry/e.js', client)).toBe('export default 1;\n');
	});

	test("the client leg points `$app` imports at the shims and drops each lake's JS", () => {
		const { compiler, rows } = make();
		const src = dedent`
			import { page } from '$app/state';
			import Lake from './Lake.svelte';
		`;
		rows.set('ogygia:region/entry/e.js', { role: 'entry', source: src, lakes: ['Lake'] });
		const out = String(compiler.emit('ogygia:region/entry/e.js', client));
		expect(out).toContain(JSON.stringify(SHIM));
		expect(out).not.toContain('$app/state');
		expect(out).not.toContain('./Lake.svelte');
		expect(out).toContain(STUB);
		expect(compiler.emit('ogygia:region/entry/e.js', server)).toBe(src);
	});

	test('a module of values only is free of side effects; a module that runs is not', () => {
		const { compiler } = make();
		const value = compiler.emit('\0ogygia:server/runtime-url', server);
		expect(value).toMatchObject({ moduleSideEffects: false });
		expect(text(value)).toContain('runtime_url');
		expect(typeof compiler.emit('\0ogygia:boot/runtime', client)).toBe('string');
	});
});

describe('resolve_id', () => {
	const none = async () => null;

	test('the client binding stub and the CSS-only graph resolve to their own modules', async () => {
		const { compiler } = make();
		expect(
			await compiler.resolve_id(CLIENT_BINDING_STUB, undefined, { ssr: false, resolve: none })
		).toBe(STUB);
		const fouc = `${FOUC_SCOPED_PREFIX}x.js`;
		expect(await compiler.resolve_id(fouc, undefined, { ssr: false, resolve: none })).toBe(
			`\0${fouc}`
		);
	});

	test('island code imports the `$app` shims on the client, and Kit itself on the server', async () => {
		const { compiler, program } = make();
		const helper = `${ROOT}/src/lib/helper.ts`;
		program.island_graph.add(helper);
		const r = (ssr: boolean) => compiler.resolve_id('$app/state', helper, { ssr, resolve: none });
		expect(await r(false)).toBe(SHIM);
		expect(await r(true)).toBe(null);
	});

	test('a region module id in any dev form resolves to its registered row and joins the island graph', async () => {
		const { compiler, program, rows } = make();
		const entry = 'ogygia:region/entry/abc.js';
		rows.set(entry, { role: 'entry', source: '' });
		expect(
			await compiler.resolve_id(`${entry}?v=1`, undefined, { ssr: false, resolve: none })
		).toBe(entry);
		expect(program.island_graph.has(entry)).toBe(true);
		const on_disk = `${ROOT}/src/.ogygia/A.svelte`;
		rows.set(on_disk, { role: 'entry', source: '' });
		for (const form of [`/@fs${on_disk}`, '/@id/src/.ogygia/A.svelte']) {
			program.island_graph.clear();
			expect(await compiler.resolve_id(form, undefined, { ssr: false, resolve: none }), form).toBe(
				on_disk
			);
			expect(program.island_graph.has(on_disk)).toBe(true);
		}
	});

	test("a generated module's relative import resolves from its host, and joins the island graph", async () => {
		const { compiler, program, rows } = make();
		const entry = 'ogygia:region/entry/abc.js';
		const host = `${ROOT}/src/routes/+page.svelte`;
		rows.set(entry, { role: 'entry', source: '', hostPath: host });
		const asked: string[] = [];
		const resolved = await compiler.resolve_id('./x.ts', entry, {
			ssr: false,
			resolve: async (s, importer) => {
				asked.push(importer);
				return { id: `${ROOT}/src/routes/x.ts?v=1` };
			}
		});
		expect(resolved).toEqual({ id: `${ROOT}/src/routes/x.ts?v=1` });
		expect(asked).toEqual([host]);
		expect(program.island_graph.has(`${ROOT}/src/routes/x.ts`)).toBe(true);
	});

	test("island code's own imports join the island graph on the client", async () => {
		const { compiler, program } = make();
		const helper = `${ROOT}/src/lib/helper.ts`;
		program.island_graph.add(helper);
		await compiler.resolve_id('./dep.ts', helper, {
			ssr: false,
			resolve: async () => ({ id: `${ROOT}/src/lib/dep.ts` })
		});
		expect(program.island_graph.has(`${ROOT}/src/lib/dep.ts`)).toBe(true);
	});
});
