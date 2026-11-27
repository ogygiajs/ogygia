import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { Compiler } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { CompileCtx } from '../src/ctx.ts';
import { normalize_import_keys } from '../src/region/transform.ts';
import { memory_fs } from '../src/fs.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/memory-app';
const PKG = `${ROOT}/node_modules/pkg-shared`;

function app_files(): Record<string, string> {
	return {
		[`${ROOT}/src/routes/+layout.ts`]: `export const csr = false;\n`,
		[`${ROOT}/src/routes/+page.svelte`]: dedent`
			<script>
			import Reader from '$lib/Reader.svelte' with { wake: 'load' };
			</script>
			<Reader />
		`,
		[`${ROOT}/src/lib/Reader.svelte`]: dedent`
			<script>
			import { read } from 'pkg-shared';
			import { local } from './local.ts';
			import { view } from './view.tsx';
			</script>
			<p>{read()} {local} {view}</p>
		`,
		[`${ROOT}/src/lib/local.ts`]: `export const local = 1;\n`,
		[`${ROOT}/src/lib/view.tsx`]: dedent`
			import { deep } from './deep.mts';
			export const view = () => <b>{deep}</b>;
		`,
		[`${ROOT}/src/lib/deep.mts`]: `export { deeper as deep } from './deeper.cts';\n`,
		[`${ROOT}/src/lib/deeper.cts`]: `export { last as deeper } from './last.jsx';\n`,
		[`${ROOT}/src/lib/last.jsx`]: dedent`
			import { end } from './end.ts';
			export const last = () => <i>{end}</i>;
		`,
		[`${ROOT}/src/lib/end.ts`]: `export const end = 1;\n`,
		[`${ROOT}/src/lib/late.ts`]: dedent`
			import { page } from '$app/state';
			export const late = () => page.url.pathname;
		`,
		[`${ROOT}/src/lib/late-plain.ts`]: `export const late_plain = 1;\n`,
		[`${ROOT}/src/lib/late-comment.ts`]: dedent`
			/** @example import { invalidate } from '$app/navigation'; */
			export const late_comment = 1;
		`,
		[`${PKG}/index.js`]: dedent`
			// import { gone } from 'pkg-commented';
			/** @example import { tryLogin } from '$lib/server/auth' */
			export * from './state.js';
			export * from './typed.ts';
		`,
		[`${PKG}/state.js`]: dedent`
			import { page } from '$app/state';
			export const read = () => page.url.pathname;
			export const later = () => import('./lazy.js');
			export const computed = (name) => import(name);
		`,
		[`${PKG}/typed.ts`]: dedent`
			import type { T } from 'pkg-types';
			import { type U } from 'pkg-types-inline';
			export type { V } from 'pkg-types-export';
			export const typed: T | U | null = null;
		`,
		[`${PKG}/lazy.js`]: `export const lazy = 1;\n`
	};
}

/** The bundler's resolver, faked: a package by name, a relative import against the files. It
 *  counts each ask and the most asks in flight at once. */
function fake_resolver(files: Record<string, string>) {
	const asked: string[] = [];
	let in_flight = 0;
	let most = 0;
	const resolve = async (spec: string, importer: string): Promise<string | null> => {
		asked.push(`${path.relative(ROOT, importer)} > ${spec}`);
		in_flight++;
		most = Math.max(most, in_flight);
		await Promise.resolve();
		in_flight--;
		if (spec === 'pkg-shared') return `${PKG}/index.js`;
		if (!spec.startsWith('.')) return null;
		const abs = path.resolve(path.dirname(importer), spec);
		return abs in files ? abs : null;
	};
	return { resolve, asked, most: () => most };
}

function make_compiler(files: ReturnType<typeof memory_fs>, rules = false) {
	const program = new Program({ forms: true, router: true });
	const ctx = new CompileCtx(
		partial_ctx_init({
			root: ROOT,
			base: '/',
			libDir: `${ROOT}/src/lib`,
			is_dev: false,
			is_build: true,
			rules,
			id_salt: '',
			visibleMargin: '0px',
			presets: {},
			import_keys: normalize_import_keys(undefined),
			resolve_alias: [],
			pkg_root: '/nowhere/ogygia',
			app_shims: { '$app/state': '/nowhere/ogygia/shims/app-state.svelte.js' },
			fs: files
		})
	);
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
		ctx
	);
	return { compiler, program };
}

async function client_build(compiler: Compiler, resolve: ReturnType<typeof fake_resolver>) {
	compiler.start_leg('client', false);
	compiler.prescan();
	await compiler.follow_island_closure(resolve.resolve);
}

describe('a client build follows each island through its package imports before any module loads', () => {
	test('a package module an island reaches, at any depth and through a literal import(), is island code before any transform asks', async () => {
		const source = app_files();
		const { compiler } = make_compiler(memory_fs(source));
		const resolver = fake_resolver(source);
		await client_build(compiler, resolver);
		const { island_graph } = compiler.program;
		for (const file of ['index.js', 'state.js', 'typed.ts', 'lazy.js'])
			expect(island_graph.has(`${PKG}/${file}`), file).toBe(true);
		expect(island_graph.has(`${ROOT}/src/lib/local.ts`), 'the app walk').toBe(true);
	});

	test('an island’s .tsx, .mts, .cts and .jsx imports are read and followed like its .ts ones', async () => {
		const source = app_files();
		const { compiler } = make_compiler(memory_fs(source));
		await client_build(compiler, fake_resolver(source));
		const { island_graph } = compiler.program;
		for (const file of ['deep.mts', 'deeper.cts', 'last.jsx', 'end.ts'])
			expect(island_graph.has(`${ROOT}/src/lib/${file}`), file).toBe(true);
	});

	test('an import in a comment and a whole-statement type import in a package are not followed; one whose names are each `type` is', async () => {
		const source = app_files();
		const { compiler } = make_compiler(memory_fs(source));
		const resolver = fake_resolver(source);
		await client_build(compiler, resolver);
		const specs = resolver.asked.map((a) => a.split(' > ')[1]);
		for (const spec of ['pkg-commented', '$lib/server/auth', 'pkg-types', 'pkg-types-export'])
			expect(specs, spec).not.toContain(spec);
		expect(specs).toContain('pkg-types-inline');
	});

	test('the bundler is asked only past where the app walk stopped, and a level of imports at once', async () => {
		const source = app_files();
		const { compiler } = make_compiler(memory_fs(source));
		const resolver = fake_resolver(source);
		await client_build(compiler, resolver);
		expect(resolver.asked).toEqual([
			'src/lib/Reader.svelte > pkg-shared',
			'node_modules/pkg-shared/index.js > ./state.js',
			'node_modules/pkg-shared/index.js > ./typed.ts',
			'node_modules/pkg-shared/state.js > ./lazy.js',
			'node_modules/pkg-shared/typed.ts > pkg-types-inline'
		]);
		expect(resolver.most()).toBe(2);
	});

	test('a rebuild of one compiler asks the bundler again only for the app files’ imports and the package imports that did not resolve', async () => {
		const source = app_files();
		const { compiler } = make_compiler(memory_fs(source));
		const first = fake_resolver(source);
		await client_build(compiler, first);
		const again = fake_resolver(source);
		await client_build(compiler, again);
		expect(again.asked).toEqual([
			'src/lib/Reader.svelte > pkg-shared',
			'node_modules/pkg-shared/typed.ts > pkg-types-inline'
		]);
		expect(compiler.program.island_graph.has(`${PKG}/lazy.js`)).toBe(true);
	});

	test('a package import the bundler could not resolve is asked again on the next rebuild, and joins when it resolves', async () => {
		const source = app_files();
		const { compiler } = make_compiler(memory_fs(source));
		const working = fake_resolver(source);
		const failing = (spec: string, importer: string) =>
			spec === './lazy.js' ? Promise.resolve(null) : working.resolve(spec, importer);
		compiler.start_leg('client', false);
		compiler.prescan();
		await compiler.follow_island_closure(failing);
		expect(compiler.program.island_graph.has(`${PKG}/lazy.js`)).toBe(false);
		const again = fake_resolver(source);
		await client_build(compiler, again);
		expect(again.asked).toContain('node_modules/pkg-shared/state.js > ./lazy.js');
		expect(compiler.program.island_graph.has(`${PKG}/lazy.js`)).toBe(true);
	});
});

describe('a rules build stops when a module that reads `$app/*` joins the island graph after its client transform', () => {
	const READER = `${ROOT}/src/lib/Reader.svelte`;

	async function late_join(o: { rules: boolean; transform_first: boolean; file?: string }) {
		const file = o.file ?? 'late.ts';
		const abs = `${ROOT}/src/lib/${file}`;
		const source = app_files();
		const { compiler } = make_compiler(memory_fs(source), o.rules);
		const resolver = fake_resolver(source);
		await client_build(compiler, resolver);
		const leg = compiler.leg({ name: 'client', server: false });
		const transform = () =>
			compiler.transform_module(source[abs], abs, { leg, emitFile: () => '' });
		if (o.transform_first) await transform();
		const resolved = await compiler.resolve_id(`./${file}`, READER, {
			ssr: false,
			resolve: async (spec, importer) => {
				const id = await resolver.resolve(spec, importer);
				return id === null ? null : { id };
			}
		});
		if (!o.transform_first) await transform();
		return { compiler, resolved, abs };
	}

	test('an import the walk cannot see joins when it resolves from island code', async () => {
		const { compiler, resolved, abs } = await late_join({ rules: true, transform_first: false });
		expect(resolved).toEqual({ id: abs });
		expect(compiler.program.island_graph.has(abs)).toBe(true);
		expect(() => compiler.check_island_order()).not.toThrow();
	});

	test('one that joins after its client transform ran fails the rule', async () => {
		const { compiler } = await late_join({ rules: true, transform_first: true });
		expect(() => compiler.check_island_order()).toThrow(/src\/lib\/late\.ts/);
	});

	test('one that imports no `$app/*` builds the same either way, so its late join passes', async () => {
		const { compiler, abs } = await late_join({
			rules: true,
			transform_first: true,
			file: 'late-plain.ts'
		});
		expect(compiler.program.island_graph.has(abs)).toBe(true);
		expect(() => compiler.check_island_order()).not.toThrow();
	});

	test('one that names `$app/*` only in a comment imports none, so its late join passes', async () => {
		const { compiler, abs } = await late_join({
			rules: true,
			transform_first: true,
			file: 'late-comment.ts'
		});
		expect(compiler.program.island_graph.has(abs)).toBe(true);
		expect(() => compiler.check_island_order()).not.toThrow();
	});

	test('a build without the rules does not check', async () => {
		const { compiler } = await late_join({ rules: false, transform_first: true });
		expect(() => compiler.check_island_order()).not.toThrow();
	});
});
