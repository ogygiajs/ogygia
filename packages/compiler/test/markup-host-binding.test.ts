// A MARKUP route host (content's `+page.md`) runs the region transform in the preprocessor, before
// the compile knows its leg, so it always imports the real region binding. On the client leg of a
// build, a csr=false route host's binding resolves to the stub a `.svelte` host links there: Kit
// never boots that page, and the real binding pulled Region and every island wrapper into Kit's
// client graph, which shares its modules (Svelte's above all) with the islands of every page.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../dist/index.js';
import { partial_ctx_init } from './_compile-ctx.ts';

let root = '';
const STUB = '/nowhere/ogygia/ClientBindingStub.svelte';

function write(rel: string, src: string) {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, src);
}

function make_compiler(is_build: boolean) {
	const program = new Program({ forms: false, router: false });
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
	const compiler = new Compiler(program, profiler);
	compiler.configure(
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				libDir: path.join(root, 'src/lib'),
				is_dev: !is_build,
				is_build,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				client_binding_stub_file: STUB,
				app_shims: {}
			})
		)
	);
	return compiler;
}

const resolve = async () => null;
const host = (rel: string) => path.join(root, 'src/routes', rel);
const BINDING = 'ogygia:region/binding/0123456789ab.js';
const WRAPPER = 'ogygia:region/wrapper/0123456789ab.svelte';

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-markup-host-'));
	write('src/routes/+layout.ts', 'export const csr = false;\n');
	write('src/routes/posts/a/+page.md', '# a\n');
	write('src/routes/posts/+layout.md', '<slot />\n');
	write('src/routes/kit/+page.md', '# kit\n');
	write('src/routes/kit/+page.ts', 'export const csr = true;\n');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('a markup route host links the client binding stub', () => {
	test('csr=false markdown page, client leg of a build → the stub', async () => {
		const compiler = make_compiler(true);
		for (const source of [BINDING, WRAPPER]) {
			const id = await compiler.resolve_id(source, host('posts/a/+page.md'), {
				ssr: false,
				resolve
			});
			expect(id, source).toBe(STUB);
		}
	});

	test('the server leg, a csr=true page and dev keep the real binding', async () => {
		const build = make_compiler(true);
		const server = { ssr: true, resolve };
		const client = { ssr: false, resolve };
		expect(await build.resolve_id(BINDING, host('posts/a/+page.md'), server)).not.toBe(STUB);
		expect(await build.resolve_id(BINDING, host('kit/+page.md'), client)).not.toBe(STUB);
		// a csr=false layout of an app with a csr=true route: Kit can hydrate it (a csr=true child, an
		// error render), so it keeps its real binding — what a `.svelte` layout links there too
		expect(await build.resolve_id(BINDING, host('posts/+layout.md'), client)).not.toBe(STUB);
		const dev = make_compiler(false);
		expect(await dev.resolve_id(BINDING, host('posts/a/+page.md'), client)).not.toBe(STUB);
	});
});
