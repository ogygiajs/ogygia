// The compiler reads an app's files through one seam (`CompileCtx.fs`), so a whole compile can run
// on files that exist only in memory: the compiler's DST harness edits them and compares a dev
// session against a cold one. A direct disk read in the compiler is a hole in that seam.
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { memory_fs } from '../src/compiler/fs.ts';
import {
	clientBuildWillSkip,
	csrTrueRouteIds,
	page_route_config,
	routeCsrIsFalse,
	route_reader
} from '../src/compiler/kit.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/memory-app';
const ROUTES = `${ROOT}/src/routes`;

function app_files(): Record<string, string> {
	return {
		[`${ROUTES}/+layout.ts`]: `export const csr = false;\n`,
		[`${ROUTES}/+page.svelte`]: dedent`
			<script>
			import Counter from '$lib/Counter.svelte' with { wake: 'load' };
			</script>
			<Counter />
		`,
		[`${ROUTES}/live/+page.ts`]: dedent`
			export const csr = true;
			export const config = { tier: 'gold' };
		`,
		[`${ROUTES}/live/+page.svelte`]: `<p>live</p>\n`,
		[`${ROOT}/src/lib/Counter.svelte`]: dedent`
			<script>
			import Step from './Step.svelte';
			let n = $state(0);
			</script>
			<button onclick={() => n++}>{n}</button><Step />
		`,
		[`${ROOT}/src/lib/Step.svelte`]: `<span>step</span>\n`
	};
}

function make_compiler(files: ReturnType<typeof memory_fs>) {
	const program = new Program({ forms: true, router: true });
	const ctx = new CompileCtx(
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
	return { compiler, program, ctx };
}

describe('the compiler reads an app through its fs seam', () => {
	test('a prescan of an app that exists only in memory registers its region and its closure', () => {
		const files = memory_fs(app_files());
		const { compiler, program } = make_compiler(files);
		compiler.prescan();
		const components = [...program.registry.values()].map((e) => e.componentPath);
		expect(components).toContain(`${ROOT}/src/lib/Counter.svelte`);
		// the closure walk finds the island's own import by the seam's `stat`
		expect(program.island_graph.has(`${ROOT}/src/lib/Step.svelte`)).toBe(true);
	});

	test('route worlds and route config come from the seam, and each file system has its own', () => {
		const a = memory_fs(app_files());
		const b = memory_fs({ ...app_files(), [`${ROUTES}/+layout.ts`]: `export const csr = true;\n` });
		const ra = route_reader(a);
		const rb = route_reader(b);
		expect(route_reader(a)).toBe(ra); // one cache set per file system
		expect(routeCsrIsFalse(ra, `${ROUTES}/+page.svelte`, ROUTES)).toBe(true);
		expect(routeCsrIsFalse(rb, `${ROUTES}/+page.svelte`, ROUTES)).toBe(false);
		expect(csrTrueRouteIds(ra, ROUTES)).toEqual(['/live']);
		expect(clientBuildWillSkip(ra, ROUTES)).toBe(false);
		expect(page_route_config(ra, ROUTES, ['tier'])).toEqual({ '/': {}, '/live': { tier: 'gold' } });
	});

	test('an edit to a file in memory is seen once the route caches are cleared', () => {
		const files = memory_fs(app_files());
		const { ctx } = make_compiler(files);
		expect(routeCsrIsFalse(ctx.routes, `${ROUTES}/+page.svelte`, ROUTES)).toBe(true);
		files.set(`${ROUTES}/+layout.ts`, null);
		ctx.routes.clear();
		expect(routeCsrIsFalse(ctx.routes, `${ROUTES}/+page.svelte`, ROUTES)).toBe(false);
	});

	test('memory_fs lists a directory sorted, with no entry for a removed file', () => {
		const files = memory_fs({ '/a/z.ts': '', '/a/b/c.ts': '', '/a/m.ts': '' });
		expect(files.list('/a')?.map((e) => `${e.name}:${e.kind}`)).toEqual([
			'b:dir',
			'm.ts:file',
			'z.ts:file'
		]);
		files.set('/a/b/c.ts', null);
		expect(files.list('/a')?.map((e) => e.name)).toEqual(['m.ts', 'z.ts']);
		expect(files.stat('/a/b')).toBe(null);
		expect(files.read('/a/m.ts')).toBe('');
		expect(files.read('/a/nope.ts')).toBe(null);
	});
});

// Each direct `node:fs` call left in the compiler, by file, and why it is not an app read. A new
// one fails here: route it through `ctx.fs`, or add it with its reason.
const DIRECT_FS: Record<string, { calls: number; why: string }> = {
	'fs.ts': { calls: 3, why: 'the seam itself: the node file system' },
	'build-cache.ts': { calls: 5, why: "the build cache's own directory, written and read back" },
	'kit.ts': {
		calls: 10,
		why: "Kit's package files, the app's hooks, the keepalive route and stale dirs it writes"
	},
	'virtual/core.ts': { calls: 2, why: "ogygia's own package.json (the dev runtime's location)" },
	'link/build-output.ts': { calls: 7, why: 'the build output it writes and patches' },
	'link/emit-gate.ts': { calls: 1, why: "the server leg's handoff file in the build output" },
	'link/island-deps.ts': {
		calls: 1,
		why: 'generated server code, reading its handoff at run time'
	},
	'link/page-keys.ts': { calls: 1, why: 'moving to its own package (#1335)' }
};

test('the compiler reads app files only through its fs seam', () => {
	const dir = path.join(import.meta.dirname, '../src/compiler');
	const found: Record<string, number> = {};
	for (const rel of fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
		if (!rel.endsWith('.ts')) continue;
		const src = fs.readFileSync(path.join(dir, rel), 'utf8');
		// (`ctx.fs.read(` and `r.fs.stat(` are the seam: a dot before `fs` is not a direct call)
		const n = src.match(/(?<![\w.])fs\s*\.\s*\w+\(/g)?.length ?? 0;
		if (n > 0) found[rel.split(path.sep).join('/')] = n;
	}
	expect(found).toEqual(
		Object.fromEntries(Object.entries(DIRECT_FS).map(([k, v]) => [k, v.calls]))
	);
});
