import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
const UNNAMED_LIVE_RE = /runtime_features_unnamed[\s\S]*live/;
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

/** A handoff naming only the modules the server leg compiled (no runtime named). */
const compiled = (hosts: string[]) => parse_server_handoff(server_handoff_json(hosts, 'k', []));

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

/** The server leg of a build: it compiles the page's shell from the package, as the bundler does,
 *  then finishes the chunk that holds its runtime URL. Returns the URL its pages load, and its
 *  handoff. */
async function server_leg(shell: string): Promise<{ url: string; handoff: ServerHandoff }> {
	const compiler = new_compiler();
	compiler.start_leg(SERVER.name, SERVER.server);
	compiler.prescan();
	const leg = compiler.leg(SERVER);
	await compiler.transform_module(SHELL_SOURCE, shell, { leg, emitFile: () => 'ref' });
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
		const compiler = client_compiler(compiled([shell]));
		expect(runtime(compiler)).toContain('/live.js');
		await transform_shell(compiler, shell);
		expect(late_lines(warn.mock.calls)).toEqual([]);
	} finally {
		warn.mockRestore();
	}
});

test('without the server build list, the package component is first read while bundling and is reported late', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const { shell } = app();
		const compiler = client_compiler(compiled([]));
		expect(runtime(compiler)).not.toContain('/live.js');
		await transform_shell(compiler, shell);
		expect(late_lines(warn.mock.calls)).toHaveLength(1);
	} finally {
		warn.mockRestore();
	}
});

test("ogygia's own modules the server build compiled are not read as the app's: its entry does not turn on context", () => {
	app();
	const own = `${root}/packages/ogygia/src/index.ts`;
	write(own, `export * from '@ogygia/core';\n`);
	const compiler = client_compiler(compiled([own]));
	expect(compiler.program.runtime_marks.context).toBeFalsy();
});

test('a package script that declares no ogygia.files is not read for regions, as its transform is not', () => {
	const { script } = app();
	const compiler = client_compiler(compiled([script]));
	expect(runtime(compiler)).not.toContain('/lakes.js');
});
