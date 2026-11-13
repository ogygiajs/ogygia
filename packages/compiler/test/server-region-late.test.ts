// A BUILD'S SERVER MANIFEST IS SEALED WHEN IT IS EMITTED. `ogygia:server/server-manifest` (and the
// loaders behind it) list every server region the build knows when the bundler loads it, which is
// early: the handle imports it. A deferred region whose host the start-up scan never saw (a library
// component outside `src/`, outside any declared `ogygia.files`) registers only when the bundler
// reaches that host, after the manifest was emitted. Its hole then answered 403 in production with
// no word at build time. Now the build stops, naming the host and the fix.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

let root = '';
afterEach(() => rmSync(root, { recursive: true, force: true }));
const write = (file: string, text: string) => {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
};
const MANIFEST = '\0ogygia:server/server-manifest';

/** A build's server leg on a small app, with a library beside it (outside `src/`). */
function build_compiler() {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-late-')));
	write(`${root}/src/routes/+page.svelte`, '<h1>page</h1>\n');
	write(`${root}/src/routes/+layout.ts`, 'export const csr = false;\n');
	write(`${root}/lib/Slow.svelte`, '<p>slow</p>\n');
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
	compiler.configure(
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				app_dir: '_app',
				libDir: `${root}/src/lib`,
				is_dev: false,
				is_build: true,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				runtime_dir: '/nowhere/ogygia/runtime',
				app_shims: {}
			})
		)
	);
	compiler.prescan();
	return compiler;
}

const LIBRARY_HOST = dedent`
	<script>
	import Slow from './Slow.svelte' with { render: 'deferred' };
	</script>
	<Slow />
`;

const transform_library_host = (compiler: Compiler) =>
	compiler.transform_module(LIBRARY_HOST, `${root}/lib/Card.svelte`, {
		ssr: true,
		emitFile: () => ''
	});

const manifest = (compiler: Compiler): string => {
	const out = compiler.emit(MANIFEST, { ssr: true, universalHooks: null }) as
		| string
		| { code: string };
	return typeof out === 'string' ? out : out.code;
};

test('a server region first registered after the server manifest was emitted stops the build', async () => {
	const compiler = build_compiler();
	manifest(compiler);
	await expect(transform_library_host(compiler)).rejects.toThrow(/server_region_late/);
});

test('a server region registered before the manifest is emitted is in it', async () => {
	const compiler = build_compiler();
	await transform_library_host(compiler);
	const [id] = [...compiler.program.by_id.keys()];
	expect(manifest(compiler)).toContain(JSON.stringify(id));
	// and the same host again, after the seal, is no late addition
	await expect(transform_library_host(compiler)).resolves.not.toBeNull();
});
