import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { Compiler } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { CompileCtx } from '../src/ctx.ts';
import { normalize_import_keys } from '../src/region/transform.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import {
	parse_server_handoff,
	server_handoff_json,
	type ServerHandoff
} from '../src/link/emit-gate.ts';
import { dedent } from '@ogygia/core/contract';

let root = '';
afterEach(() => rmSync(root, { recursive: true, force: true }));
const write = (file: string, text: string) => {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
};
const RUNTIME_ENTRY = '\0ogygia:boot/runtime-entry';
const HYDRATE_FEATURES = '\0ogygia:boot/hydrate-features';
const RUNTIME_URL = '\0ogygia:server/runtime-url';
const SERVER = { name: 'ssr', server: true };
const OG_RUNTIME_RE = /^\/_app\/ogygia\/og-runtime\.0123456789ab-[0-9a-f]{8}\.js$/;
const UNNAMED_LIVE_RE = /runtime_features_unnamed[\s\S]*live|live[\s\S]*runtime_features_unnamed/;
const NO_SERVER_RUNTIME_RE = /server_runtime_unnamed/;
const SERVER_FEATURES_LATE_RE = /server_features_late[\s\S]*live/;
const CLIENT = { name: 'client', server: false };

/** An app whose page places a shell from an installed package that declares no `ogygia.files`.
 *  The shell keeps its sidebar (`keep`), which needs the runtime's `live` feature. */
function app(): { shell: string; script: string } {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-marks-reached-')));
	write(
		`${root}/src/routes/+page.svelte`,
		`${dedent`
			<script>
				import Shell from 'shell-pkg/Shell.svelte';
			</script>
			<Shell />
		`}\n`
	);
	write(`${root}/src/routes/+layout.ts`, 'export const csr = false;\n');
	const pkg = `${root}/node_modules/shell-pkg`;
	write(`${pkg}/package.json`, '{ "name": "shell-pkg", "type": "module" }\n');
	write(
		`${pkg}/Shell.svelte`,
		`${dedent`
			<script>
				import Sidebar from './Sidebar.svelte' with { wake: 'load', keep: 'og-sidebar' };
			</script>
			<Sidebar />
		`}\n`
	);
	write(`${pkg}/Sidebar.svelte`, '<nav>side</nav>\n');
	write(
		`${pkg}/lake.ts`,
		`${dedent`
			import Pool from './Sidebar.svelte' with { wake: 'none' };
			export { Pool };
		`}\n`
	);
	return { shell: `${pkg}/Shell.svelte`, script: `${pkg}/lake.ts` };
}

function new_compiler(): Compiler {
	return new Compiler(
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
}

function client_compiler(handoff: ServerHandoff | null): Compiler {
	const compiler = new_compiler();
	compiler.start_leg(CLIENT.name, CLIENT.server, handoff);
	compiler.prescan();
	return compiler;
}

const SHELL_SOURCE = `${dedent`
	<script>
		import Sidebar from './Sidebar.svelte' with { wake: 'load', keep: 'og-sidebar' };
	</script>
	<Sidebar />
`}\n`;

/** The server leg of a build in `compiler`: it compiles `files` (path → source) as the bundler
 *  does, then finishes the chunk that holds its runtime URL. Returns the URL its pages load, and
 *  its handoff. */
async function server_pass(
	compiler: Compiler,
	files: ReadonlyArray<[string, string]>
): Promise<{ url: string; handoff: ServerHandoff }> {
	compiler.start_leg(SERVER.name, SERVER.server);
	compiler.prescan();
	const leg = compiler.leg(SERVER);
	for (const [file, source] of files)
		await compiler.transform_module(source, file, { leg, emitFile: () => 'ref' });
	const value = compiler.emit(RUNTIME_URL, { ssr: true, universalHooks: null });
	const code = typeof value === 'string' ? value : (value as { code: string }).code;
	const json = server_handoff_json(
		compiler.ssr_transformed_hosts(),
		'k',
		[],
		compiler.server_runtime()
	);
	const out = compiler.relocate(code, leg, {
		graph: () => null,
		module_ids: () => [],
		chunk_file: 'runtime-url.js',
		file_name: String,
		facade_file: () => undefined
	});
	const url = /"([^"]*og-runtime[^"]*)"/.exec(out?.code ?? code)?.[1] ?? '';
	return { url, handoff: parse_server_handoff(json) };
}

/** A server leg of its own that compiles the package's shell. */
const server_leg = (shell: string) => server_pass(new_compiler(), [[shell, SHELL_SOURCE]]);

/** A server leg of its own that compiles `file` as it is on disk. */
const server_leg_of = (file: string) =>
	server_pass(new_compiler(), [[file, readFileSync(file, 'utf8')]]);

const late_lines = (calls: unknown[][]) =>
	calls.map((c) => String(c[0])).filter((l) => l.includes('runtime_marks_late'));

/** The client runtime as the build makes it: the boot entry, then its hydrate-phase features. */
const runtime = (compiler: Compiler) =>
	[RUNTIME_ENTRY, HYDRATE_FEATURES]
		.map((id) => compiler.emit(id, { ssr: false, universalHooks: null }))
		.map((m) => (typeof m === 'string' ? m : (m as { code: string }).code))
		.join('\n');

/** The bundler reaching the shell in the client leg, after the runtime was made. */
const transform_shell = (compiler: Compiler, shell: string) =>
	compiler.transform_module(SHELL_SOURCE, shell, {
		leg: compiler.leg(CLIENT),
		emitFile: () => 'ref'
	});

test('the runtime the server leg names in its pages is the one the client leg ships, when a package component needs a feature', async () => {
	const { shell } = app();
	const server = await server_leg(shell);
	expect(server.url).toMatch(OG_RUNTIME_RE);
	const client = client_compiler(server.handoff);
	expect(client.runtime_chunk_url()).toBe(server.url);
	expect(runtime(client)).toContain('/live.js');
});

test('a client leg that finds a feature the server leg did not name stops the build, naming it', () => {
	const { shell } = app();
	const handoff = parse_server_handoff(
		server_handoff_json([shell], 'k', [], {
			marks: { complete: true, hydrate: ['load'], router: true, forms: true },
			feature_hash: 'feedbeef'
		})
	);
	expect(() => client_compiler(handoff)).toThrow(UNNAMED_LIVE_RE);
});

test('a package component the server build compiled keeps its region: the client runtime ships live and nothing is reported late', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const { shell } = app();
		const compiler = client_compiler((await server_leg(shell)).handoff);
		expect(runtime(compiler)).toContain('/live.js');
		await transform_shell(compiler, shell);
		expect(late_lines(warn.mock.calls)).toEqual([]);
	} finally {
		warn.mockRestore();
	}
});

test('a client-only build (no server leg, no handoff) first reads the package component while bundling, and reports it late', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const { shell } = app();
		const compiler = client_compiler(null);
		expect(runtime(compiler)).not.toContain('/live.js');
		await transform_shell(compiler, shell);
		expect(late_lines(warn.mock.calls)).toHaveLength(1);
	} finally {
		warn.mockRestore();
	}
});

test("ogygia's own modules the server build compiled are not read as the app's: its entry does not turn on context", async () => {
	app();
	const own = `${root}/packages/ogygia/src/index.ts`;
	write(own, `export * from '@ogygia/core';\n`);
	const { handoff } = await server_leg_of(own);
	expect(handoff.runtime?.marks.context).toBeFalsy();
	expect(client_compiler(handoff).program.runtime_marks.context).toBeFalsy();
});

test('a package script that declares no ogygia.files is not read for regions, as its transform is not', async () => {
	const { script } = app();
	const compiler = client_compiler((await server_leg_of(script)).handoff);
	expect(runtime(compiler)).not.toContain('/lakes.js');
});

test('one compiler that builds the server leg and then the client leg names one runtime for both', async () => {
	const { shell } = app();
	const compiler = new_compiler();
	const server = await server_pass(compiler, [[shell, SHELL_SOURCE]]);
	compiler.start_leg(CLIENT.name, CLIENT.server);
	compiler.prescan();
	expect(compiler.runtime_chunk_url()).toBe(server.url);
	expect(runtime(compiler)).toContain('/live.js');
});

test('one compiler whose client leg shipped its runtime before the server leg found a feature stops the build, naming it', async () => {
	const { shell } = app();
	const compiler = new_compiler();
	compiler.start_leg(CLIENT.name, CLIENT.server);
	compiler.prescan();
	runtime(compiler);
	await expect(server_pass(compiler, [[shell, SHELL_SOURCE]])).rejects.toThrow(UNNAMED_LIVE_RE);
});

test('one compiler whose client leg ran first names one runtime for both when the server leg finds nothing new', async () => {
	app();
	const compiler = new_compiler();
	compiler.start_leg(CLIENT.name, CLIENT.server);
	compiler.prescan();
	runtime(compiler);
	const server = await server_pass(compiler, []);
	expect(compiler.runtime_chunk_url()).toBe(server.url);
});

test('a handoff from a server leg that named no runtime stops the client build instead of naming one of its own', () => {
	const { shell } = app();
	const handoff = parse_server_handoff(server_handoff_json([shell], 'k', []));
	expect(() => client_compiler(handoff)).toThrow(NO_SERVER_RUNTIME_RE);
});

test('a package component the server build compiled after its feature word was fixed, needing a feature the word left out, stops the build, naming the feature and the module', async () => {
	const { shell } = app();
	const compiler = new_compiler();
	compiler.start_leg(SERVER.name, SERVER.server);
	compiler.prescan();
	compiler.emit('\0ogygia:server/runtime-flags', { ssr: true, universalHooks: null });
	expect(compiler.server_word()).not.toBeNull();
	const leg = compiler.leg(SERVER);
	await compiler.transform_module(SHELL_SOURCE, shell, { leg, emitFile: () => 'ref' });
	expect(() => compiler.server_runtime()).toThrow(SERVER_FEATURES_LATE_RE);
	expect(() => compiler.server_runtime()).toThrow(/Shell\.svelte/);
});
