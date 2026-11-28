// KIT-PUBLIC-ENV: the build's identity on Kit's env channel. The server module and the browser's
// reader carry the same one for one app, so the reader takes its own server's env; another app (a
// federated peer) has another, so its reader never takes the host's env as its own.
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
		routes_dir: `${root}/src/routes`,
		out_dir: `${root}/.svelte-kit`,
		mode: 'build' as 'dev' | 'build',
		fs: memory_fs(all)
	};
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

	it('differs for another app: another name, base or app dir', () => {
		const host = kit_env_build(app('/app', 'host-app'));
		expect(kit_env_build(app('/app', 'peer-app'))).not.toBe(host);
		expect(kit_env_build(app('/app', 'host-app', { base: '/peer' }))).not.toBe(host);
		expect(kit_env_build(app('/app', 'host-app', { app_dir: '_peer' }))).not.toBe(host);
	});

	it('differs for two apps with the same name, base and app dir but other source', () => {
		const host = kit_env_build(app('/a/web', 'my-app'));
		const other_page = { 'src/routes/+page.svelte': '<h1>peer</h1>\n' };
		const other_lib = { 'src/routes/+page.svelte': PAGE, 'src/lib/nav.svelte': '<nav></nav>\n' };
		const other_route = { 'src/routes/+page.svelte': PAGE, 'src/routes/b/+page.svelte': PAGE };
		expect(kit_env_build(app('/b/web', 'my-app', { files: other_page }))).not.toBe(host);
		expect(kit_env_build(app('/b/web', 'my-app', { files: other_lib }))).not.toBe(host);
		expect(kit_env_build(app('/b/web', 'my-app', { files: other_route }))).not.toBe(host);
	});

	it('differs for two apps with no package.json and the same source in folders of one name', () => {
		const host = kit_env_build(app('/a/web', null));
		const other = { 'src/routes/+page.svelte': '<h1>peer</h1>\n' };
		expect(kit_env_build(app('/b/web', null, { files: other }))).not.toBe(host);
	});

	it('holds no path: one app built from another folder has the same identity', () => {
		expect(kit_env_build(app('/a/one', 'host-app'))).toBe(kit_env_build(app('/b/two', 'host-app')));
	});

	it("is the same with or without ogygia's keep-client route and other dot files in the source", () => {
		const host = kit_env_build(app('/a/web', 'my-app'));
		const with_dots = {
			'src/routes/+page.svelte': PAGE,
			'src/routes/.ogygia-keep-client/+layout.ts': 'export const csr = true;\n',
			'src/.DS_Store': 'x'
		};
		expect(kit_env_build(app('/a/web', 'my-app', { files: with_dots }))).toBe(host);
	});

	it('reads the routes where Kit is told they are, outside src too', () => {
		const at = (page: string) => {
			const a = app('/a/web', 'my-app', { files: { 'pages/+page.svelte': page } });
			return kit_env_build({ ...a, routes_dir: '/a/web/pages' });
		};
		expect(at(PAGE)).not.toBe(at('<h1>peer</h1>\n'));
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
		const a = app('/a/web', 'my-app');
		const config = '/a/web/.svelte-kit/generated/dev/env/config.js';
		a.fs.set(config, STATIC_ONLY_CONFIG);
		const compiler = compiler_of(a, false);
		expect(compiler.kit_env_build()).toBe('');
		a.fs.set(config, DYNAMIC_CONFIG);
		const made = compiler.kit_env_build();
		expect(made).toBe(kit_env_build({ ...a, mode: 'dev' }));
		a.fs.set('/a/web/src/routes/+page.svelte', '<h1>edited</h1>\n');
		expect(compiler.kit_env_build()).toBe(made);
	});

	it("a build makes its identity once, kept on the build its next leg's context carries on: both legs bear one, though the source changes between them", () => {
		const a = app('/a/web', 'my-app');
		a.fs.set('/a/web/.svelte-kit/generated/build/env/config.js', DYNAMIC_CONFIG);
		const server = compiler_of(a, true);
		const made = server.kit_env_build();
		a.fs.set('/a/web/src/lib/Generated.svelte', '<p>written mid-build</p>\n');
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

	it("is made from the source when Kit's env config cannot be read", () => {
		expect(kit_env_build(app('/a/web', 'my-app'))).toMatch(/^[0-9a-f]{12}$/);
	});
});
