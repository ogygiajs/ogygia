// KIT-PUBLIC-ENV: the build's identity on Kit's env channel. The server module and the browser's
// reader carry the same one for one app, so the reader takes its own server's env; another app (a
// federated peer) has another, so its reader never takes the host's env as its own.
import { tmpdir } from 'node:os';
import { dedent } from '@ogygia/core/contract';
import { describe, expect, it } from 'vitest';
import { memory_fs, type Fs } from '../src/fs.ts';
import { CompileCtx, normalize_import_keys } from '../src/index.ts';
import { Compiler } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { open_dev_bridge } from '../src/dev-bridge.ts';
import { kit_env_build, kit_env_reader_module, kit_public_env_module } from '../src/kit-patches.ts';

const PAGE = '<h1>home</h1>\n';

const KIT_ENV_BUILD_RE = /^export function kit_env_build\(\) \{ (.*) \}$/m;

/** The server module's `kit_env_build`, as a function (the rest of the module is not run). */
const server_build_fn = (code: string): (() => string) => {
	const body = KIT_ENV_BUILD_RE.exec(code)?.[1];
	expect(body, code).toBeDefined();
	// oxlint-disable-next-line typescript/no-implied-eval -- the module's function text under test
	return new Function(body!) as () => string;
};
const server_build = (code: string): string => server_build_fn(code)();

const app = (
	root: string,
	name: string | null,
	{
		base = '',
		app_dir = '_app',
		files = { 'src/routes/+page.svelte': PAGE } as Record<string, string>
	} = {}
) => {
	const all: Record<string, string> = {};
	if (name !== null) all[`${root}/package.json`] = JSON.stringify({ name });
	for (const [rel, text] of Object.entries(files)) all[`${root}/${rel}`] = text;
	return {
		root,
		base,
		app_dir,
		out_dir: `${root}/.svelte-kit`,
		mode: 'build' as 'dev' | 'build',
		fs: memory_fs(all),
		browser_files: () => Object.keys(files).map((rel) => `${root}/${rel}`)
	};
};

const ISLAND_PAGE = dedent`
	<script>
	import Counter from '$lib/Counter.svelte' with { wake: 'load' };
	</script>
	<Counter />
`;
const COUNTER = dedent`
	<script>
	import { step } from './step.ts';
	let n = $state(0);
	</script>
	<button onclick={() => (n += step)}>{n}</button>
`;
/** An app whose page places an island, with server-only files beside it. */
const ISLAND_APP: Record<string, string> = {
	'src/routes/+layout.ts': 'export const csr = false;\n',
	'src/routes/+page.svelte': ISLAND_PAGE,
	'src/routes/+page.server.ts': 'export const load = () => ({ n: 1 });\n',
	'src/lib/server/x.ts': "export const SECRET = 'hunter2';\n",
	'src/lib/Counter.svelte': COUNTER,
	'src/lib/step.ts': 'export const step = 1;\n'
};

const STATIC_ONLY_CONFIG = dedent`
	const variables = {};
	export const explicit_public_env = {};
	export const rendered_env = {};
	explicit_public_env.PUBLIC_GREETING = "hello";
	export function set_env(env) {
		const issues = {};
		const SECRET_TOKEN = validate(variables, env.SECRET_TOKEN, "SECRET_TOKEN", issues);
		dynamic_private_env.SECRET_TOKEN = SECRET_TOKEN;
	}
`;
const DYNAMIC_CONFIG = dedent`
	export const rendered_env = {};
	export function set_env(env) {
		const issues = {};
		const PUBLIC_REGION = validate(variables, env.PUBLIC_REGION, "PUBLIC_REGION", issues);
		explicit_public_env.PUBLIC_REGION = PUBLIC_REGION;
		rendered_env.PUBLIC_REGION = PUBLIC_REGION;
	}
`;

/** `a` with Kit's generated env config for its mode, and every listing and read of its files
 *  counted. */
const with_config = (a: ReturnType<typeof app>, config: string) => {
	const files = a.fs;
	files.set(`${a.out_dir}/generated/${a.mode}/env/config.js`, config);
	const seen: string[] = [];
	const fs: Fs = {
		read: (abs) => (seen.push(abs), files.read(abs)),
		list: (dir) => (seen.push(dir), files.list(dir)),
		stat: (abs) => files.stat(abs)
	};
	return { app: { ...a, fs }, seen };
};

describe("the build's identity on Kit's env channel (KIT-PUBLIC-ENV)", () => {
	it('is the same in the server module and the browser reader of one app', () => {
		const build = kit_env_build(app('/srv/host', 'host-app'));
		const fixed = { kind: 'fixed', id: build } as const;
		expect(server_build(kit_public_env_module(3, fixed))).toBe(build);
		expect(server_build(kit_public_env_module(null, fixed))).toBe(build);
		expect(kit_env_reader_module('/rt/kit-env.js', build)).toContain(
			`read(${JSON.stringify(build)})`
		);
	});

	it("dev: the server module writes the dev server's identity as each channel is written, so an app that gains its first dynamic public variable writes the one its reader, made later, is bound to", () => {
		const code = kit_public_env_module(3, { kind: 'dev', root: '/a/web' });
		let now = '';
		const bridge = (kit_env_build: () => string) => ({ fn_manifest: () => ({}), kit_env_build });
		const close = open_dev_bridge(
			'/a/web',
			bridge(() => now)
		);
		const close_peer = open_dev_bridge(
			'/a/peer',
			bridge(() => 'peer-build')
		);
		try {
			const read = server_build_fn(code);
			expect(read()).toBe('');
			now = kit_env_build(app('/a/web', 'my-app'));
			expect(read()).toBe(now);
			close();
			expect(read()).toBe('');
		} finally {
			close();
			close_peer();
		}
	});

	it('differs for another app: another base or app dir', () => {
		const host = kit_env_build(app('/app', 'host-app'));
		expect(kit_env_build(app('/app', 'host-app', { base: '/peer' }))).not.toBe(host);
		expect(kit_env_build(app('/app', 'host-app', { app_dir: '_peer' }))).not.toBe(host);
	});

	it('differs for two apps with the same base and app dir but other browser code', () => {
		const host = kit_env_build(app('/a/web', 'my-app'));
		const other_page = { 'src/routes/+page.svelte': '<h1>peer</h1>\n' };
		const other_lib = { 'src/routes/+page.svelte': PAGE, 'src/lib/nav.svelte': '<nav></nav>\n' };
		expect(kit_env_build(app('/b/web', 'my-app', { files: other_page }))).not.toBe(host);
		expect(kit_env_build(app('/b/web', 'my-app', { files: other_lib }))).not.toBe(host);
	});

	it('holds no path: one app built from another folder has the same identity', () => {
		expect(kit_env_build(app('/a/one', 'host-app'))).toBe(kit_env_build(app('/b/two', 'host-app')));
	});

	it("is the same whichever order the island closure lists its files in, and reads no package's file", () => {
		const a = app('/a/web', 'my-app', { files: ISLAND_APP });
		const listed = [...a.browser_files()];
		const host = kit_env_build(a);
		expect(kit_env_build({ ...a, browser_files: () => [...listed].reverse() })).toBe(host);
		const pkg = '/a/web/node_modules/x-ui/index.js';
		a.fs.set(pkg, 'export const x = 1;\n');
		expect(kit_env_build({ ...a, browser_files: () => [...listed, pkg] })).toBe(host);
	});
});

describe("the build's identity is made only for an app whose payload carries an env (KIT-PUBLIC-ENV)", () => {
	for (const mode of ['dev', 'build'] as const) {
		it(`${mode}: an app with no dynamic public variable reads only Kit's env config, walks none of its source, and has no identity`, () => {
			const { app: a, seen } = with_config(
				{ ...app('/a/web', 'my-app'), mode },
				STATIC_ONLY_CONFIG
			);
			expect(kit_env_build(a)).toBe('');
			expect(seen).toEqual([`/a/web/.svelte-kit/generated/${mode}/env/config.js`]);
		});

		it(`${mode}: an app with a dynamic public variable is named by its source`, () => {
			const at = (page: string) =>
				kit_env_build(
					with_config(
						{ ...app('/a/web', 'my-app', { files: { 'src/routes/+page.svelte': page } }), mode },
						DYNAMIC_CONFIG
					).app
				);
			expect(at(PAGE)).toMatch(/^[0-9a-f]{12}$/);
			expect(at(PAGE)).not.toBe(at('<h1>peer</h1>\n'));
		});
	}

	it("reads the config of the mode it is made for, not another mode's left on disk", () => {
		const a = app('/a/web', 'my-app');
		a.fs.set('/a/web/.svelte-kit/generated/dev/env/config.js', DYNAMIC_CONFIG);
		expect(kit_env_build(with_config(a, STATIC_ONLY_CONFIG).app)).toBe('');
	});

	/** A context for `a`, served (dev) or built. */
	const ctx_of = (a: ReturnType<typeof app>, is_build: boolean) =>
		new CompileCtx(
			partial_ctx_init({
				root: a.root,
				base: '',
				app_dir: a.app_dir,
				libDir: `${a.root}/src/lib`,
				is_dev: !is_build,
				is_build,
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				presets: {},
				app_shims: {},
				fs: a.fs
			})
		);
	const compiler_of = (a: ReturnType<typeof app>, is_build: boolean) =>
		new Compiler(
			new Program({ forms: true, router: true }),
			{ prof: {} as Compiler['profiler']['prof'], P: false, outHash: new Map() },
			ctx_of(a, is_build)
		);

	it('dev: an app that gains its first dynamic public variable gets its identity, and keeps it', () => {
		const a = app('/a/web', 'my-app', { files: ISLAND_APP });
		const config = '/a/web/.svelte-kit/generated/dev/env/config.js';
		a.fs.set(config, STATIC_ONLY_CONFIG);
		const compiler = compiler_of(a, false);
		expect(compiler.kit_env_build()).toBe('');
		a.fs.set(config, DYNAMIC_CONFIG);
		const made = compiler.kit_env_build();
		expect(made).toMatch(/^[0-9a-f]{12}$/);
		a.fs.set('/a/web/src/lib/step.ts', 'export const step = 2;\n');
		expect(compiler.kit_env_build()).toBe(made);
	});

	it("a build makes its identity once, kept on the build its next leg's context carries on: both legs bear one, though the source changes between them", () => {
		const a = app('/a/web', 'my-app', { files: ISLAND_APP });
		a.fs.set('/a/web/.svelte-kit/generated/build/env/config.js', DYNAMIC_CONFIG);
		const server = compiler_of(a, true);
		const made = server.kit_env_build();
		a.fs.set('/a/web/src/lib/step.ts', 'export const step = 2;\n');
		const client = server.with_ctx(ctx_of(a, true));
		expect(client.kit_env_build()).toBe(made);
		expect(compiler_of(a, true).kit_env_build()).not.toBe(made);
	});

	it('a build with no dynamic public variable keeps having no identity', () => {
		const a = app('/a/web', 'my-app');
		const config = '/a/web/.svelte-kit/generated/build/env/config.js';
		a.fs.set(config, STATIC_ONLY_CONFIG);
		const compiler = compiler_of(a, true);
		expect(compiler.kit_env_build()).toBe('');
		a.fs.set(config, DYNAMIC_CONFIG);
		expect(compiler.kit_env_build()).toBe('');
	});

	describe('names the app by the code it ships to the browser only, so the identity it ships tells nothing of its server code', () => {
		const browser_app = (edits: Record<string, string> = {}) => {
			const a = app('/a/web', 'my-app', { files: { ...ISLAND_APP, ...edits } });
			a.fs.set('/a/web/.svelte-kit/generated/build/env/config.js', DYNAMIC_CONFIG);
			return compiler_of(a, true).kit_env_build();
		};

		it('editing a server-only file leaves the identity as it was', () => {
			const before = browser_app();
			expect(before).toMatch(/^[0-9a-f]{12}$/);
			expect(browser_app({ 'src/lib/server/x.ts': "export const SECRET = 'hunter3';\n" })).toBe(
				before
			);
			expect(
				browser_app({ 'src/routes/+page.server.ts': 'export const load = () => ({ n: 2 });\n' })
			).toBe(before);
			expect(browser_app({ 'package.json': JSON.stringify({ name: 'other-app' }) })).toBe(before);
		});

		it('editing a file an island imports changes the identity', () => {
			expect(browser_app({ 'src/lib/step.ts': 'export const step = 2;\n' })).not.toBe(
				browser_app()
			);
		});

		it('two apps with other browser code differ', () => {
			const other = { 'src/lib/Counter.svelte': COUNTER.replace('{n}', '[{n}]') };
			expect(browser_app(other)).not.toBe(browser_app());
		});

		const REMOTE_COUNTER = dedent`
			<script>
			import { step } from './step.ts';
			import { get_n } from './data.remote.ts';
			let n = $state(0);
			</script>
			<button onclick={async () => (n += step + (await get_n()))}>{n}</button>
		`;
		const REMOTE_APP: Record<string, string> = {
			'src/lib/Counter.svelte': REMOTE_COUNTER,
			'src/lib/data.remote.ts': dedent`
				import { query } from '$app/server';
				import { db } from '$lib/server/db.ts';
				import { scale } from './scale.ts';
				export const get_n = query(async () => scale(db.n));
			`,
			'src/lib/server/db.ts': "export const db = { n: 1, key: 'hunter2' };\n",
			'src/lib/scale.ts': 'export const scale = (n: number) => n * 2;\n'
		};

		it('an island that calls a remote function: editing the remote file, the server file it imports or a file only it imports leaves the identity as it was', () => {
			const before = browser_app(REMOTE_APP);
			expect(before).toMatch(/^[0-9a-f]{12}$/);
			const edited = (rel: string, text: string) => browser_app({ ...REMOTE_APP, [rel]: text });
			expect(edited('src/lib/server/db.ts', "export const db = { n: 1, key: 'hunter3' };\n")).toBe(
				before
			);
			expect(
				edited('src/lib/data.remote.ts', `// a comment\n${REMOTE_APP['src/lib/data.remote.ts']}`)
			).toBe(before);
			expect(edited('src/lib/scale.ts', 'export const scale = (n: number) => n * 3;\n')).toBe(
				before
			);
			expect(edited('src/lib/step.ts', 'export const step = 2;\n')).not.toBe(before);
		});

		it('one app under two roots, built from two working folders, has one identity', () => {
			const at = (root: string, cwd: string) => {
				const was = process.cwd();
				process.chdir(cwd);
				try {
					const a = app(root, 'my-app', { files: ISLAND_APP });
					a.fs.set(`${root}/.svelte-kit/generated/build/env/config.js`, DYNAMIC_CONFIG);
					return compiler_of(a, true).kit_env_build();
				} finally {
					process.chdir(was);
				}
			};
			const one = at('/a/web', '/');
			expect(one).toMatch(/^[0-9a-f]{12}$/);
			expect(at('/elsewhere/deep/web', '/')).toBe(one);
			expect(at('/a/web', tmpdir())).toBe(one);
		});

		it('is made from the island code the scan found: a module the bundler adds to the island graph later leaves it', async () => {
			const late = '/a/web/src/lib/late.ts';
			const a = app('/a/web', 'my-app', { files: ISLAND_APP });
			a.fs.set('/a/web/.svelte-kit/generated/build/env/config.js', DYNAMIC_CONFIG);
			const compiler = compiler_of(a, true);
			const scanned = compiler_of(a, true).kit_env_build();
			compiler.prescan();
			a.fs.set(late, 'export const late = 1;\n');
			await compiler.resolve_id('./late.ts', '/a/web/src/lib/Counter.svelte', {
				ssr: false,
				resolve: async () => ({ id: late })
			});
			expect(compiler.program.island_graph.has(late)).toBe(true);
			expect(compiler.kit_env_build()).toBe(scanned);
		});
	});

	it("is made from the source when Kit's env config cannot be read", () => {
		expect(kit_env_build(app('/a/web', 'my-app'))).toMatch(/^[0-9a-f]{12}$/);
	});
});
