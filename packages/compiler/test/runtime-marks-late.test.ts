// A BUILD'S RUNTIME IS FIXED WHEN ITS ENTRY LOADS. `ogygia:boot/runtime-entry` picks the runtime's
// features from the marks the build knows then. A region registered after that (a host outside
// `src/` the scan never saw, reached only while bundling) can need a feature the runtime lacks; the
// island then never wakes. The build says so (`runtime_marks_late`), naming the host (#1452).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
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
const RUNTIME_ENTRY = '\0ogygia:boot/runtime-entry';
const CLIENT = { name: 'client', server: false };

/** A build's client leg on a small app with one `visible` island, a library beside it (outside
 *  `src/`). */
function build_compiler(): Compiler {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-marks-late-')));
	write(
		`${root}/src/routes/+page.svelte`,
		`${dedent`
			<script>
				import W from '$lib/W.svelte' with { wake: 'visible' };
			</script>
			<W />
		`}\n`
	);
	write(`${root}/src/routes/+layout.ts`, 'export const csr = false;\n');
	write(`${root}/src/lib/W.svelte`, '<p>w</p>\n');
	write(`${root}/lib/Pool.svelte`, '<p>pool</p>\n');
	const compiler = new Compiler(
		new Program({ forms: true, router: true }),
		{
			prof: {
				transformMs: 0,
				transformN: 0,
				transformHit: 0,
				prescanMs: 0,
				resolveMs: 0,
				loadMs: 0
			} as Compiler['profiler']['prof'],
			P: false,
			outHash: new Map<string, number>()
		},
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				app_dir: '_app',
				runtime_hash: '0123456789ab',
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
				client_plugins: [],
				server_plugins: [],
				route_config: [],
				app_shims: {}
			})
		)
	);
	compiler.start_leg(CLIENT.name, CLIENT.server);
	compiler.prescan();
	return compiler;
}

const load_runtime_entry = (compiler: Compiler) =>
	compiler.emit(RUNTIME_ENTRY, { ssr: false, universalHooks: null });

/** A library host (outside `src/`) placing `Pool` with `mark`, transformed in the client leg. */
const transform_library_host = (compiler: Compiler, mark: string) =>
	compiler.transform_module(
		`${dedent`
			<script>
			import Pool from './Pool.svelte' with { ${mark} };
			</script>
			<Pool />
		`}\n`,
		`${root}/lib/Card.svelte`,
		{ leg: compiler.leg(CLIENT), emitFile: () => 'ref' }
	);

const late_lines = (calls: unknown[][]) =>
	calls.map((c) => String(c[0])).filter((l) => l.includes('runtime_marks_late'));

test('a lake first registered after the runtime entry was built is reported, naming its host', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const compiler = build_compiler();
		const entry = String(load_runtime_entry(compiler));
		expect(entry).not.toContain('lakes');
		await transform_library_host(compiler, `wake: 'none'`);
		const lines = late_lines(warn.mock.calls);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('lib/Card.svelte');
		expect(lines[0]).toContain('lakes');
	} finally {
		warn.mockRestore();
	}
});

test('a region registered after the runtime entry that needs nothing new is not reported', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const compiler = build_compiler();
		await load_runtime_entry(compiler);
		await transform_library_host(compiler, `wake: 'visible'`);
		expect(late_lines(warn.mock.calls)).toEqual([]);
	} finally {
		warn.mockRestore();
	}
});

test('a lake registered before the runtime entry loads ships in it, and is not reported', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const compiler = build_compiler();
		await transform_library_host(compiler, `wake: 'none'`);
		expect(String(load_runtime_entry(compiler))).toContain('lakes');
		expect(late_lines(warn.mock.calls)).toEqual([]);
	} finally {
		warn.mockRestore();
	}
});
