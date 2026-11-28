// KIT-PUBLIC-ENV: the build's identity on Kit's env channel. The server module and the browser's
// reader carry the same one for one app, so the reader takes its own server's env; another app (a
// federated peer) has another, so its reader never takes the host's env as its own. It is made only
// of values the app already makes public (its package name, base, app dir and Kit's version.name),
// never of a file of its source.
import { tmpdir } from 'node:os';
import { dedent } from '@ogygia/core/contract';
import { describe, expect, it, vi } from 'vitest';
import { memory_fs, type Fs } from '../src/fs.ts';
import { CompileCtx, normalize_import_keys } from '../src/index.ts';
import { Compiler } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { kit_env_build, kit_env_reader_module, kit_public_env_module } from '../src/kit-patches.ts';

const KIT_ENV_BUILD_RE = /^export function kit_env_build\(\) \{ (.*) \}$/m;
const ID_RE = /^[0-9a-f]{12}$/;

/** The server module's `kit_env_build`, as it answers (the rest of the module is not run). */
const server_build = (code: string): string => {
	const body = KIT_ENV_BUILD_RE.exec(code)?.[1];
	expect(body, code).toBeDefined();
	// oxlint-disable-next-line typescript/no-implied-eval -- the module's function text under test
	return (new Function(body!) as () => string)();
};

const COUNTER = dedent`
	<script>
	import { step } from './step.ts';
	import { get_n } from './data.remote.ts';
	let n = $state(0);
	</script>
	<button onclick={async () => (n += step + (await get_n()))}>{n}</button>
`;
/** An app whose page places an island that calls a remote function, with server-only files. */
const ISLAND_APP: Record<string, string> = {
	'src/routes/+layout.ts': 'export const csr = false;\n',
	'src/routes/+page.svelte': dedent`
		<script>
		import Counter from '$lib/Counter.svelte' with { wake: 'load' };
		</script>
		<Counter />
	`,
	'src/routes/+page.server.ts': 'export const load = () => ({ n: 1 });\n',
	'src/lib/Counter.svelte': COUNTER,
	'src/lib/step.ts': 'export const step = 1;\n',
	'src/lib/data.remote.ts': dedent`
		import { query } from '$app/server';
		import { db } from '$lib/server/db.ts';
		export const get_n = query(async () => db.n);
	`,
	'src/lib/server/db.ts': "export const db = { n: 1, key: 'hunter2' };\n",
	'src/env.js': 'export const variables = {};\n'
};

interface At {
	root?: string;
	name?: string | null;
	base?: string;
	app_dir?: string;
	version?: string | null;
	files?: Record<string, string>;
	is_build?: boolean;
}

/** The app's file system, every read of it counted. */
function app_fs({ root = '/a/web', name = 'my-app', files = ISLAND_APP }: At) {
	const all: Record<string, string> = {};
	if (name !== null) all[`${root}/package.json`] = JSON.stringify({ name, private: true });
	for (const [rel, text] of Object.entries(files)) all[`${root}/${rel}`] = text;
	const store = memory_fs(all);
	const read: string[] = [];
	const fs: Fs = {
		read: (abs) => (read.push(abs), store.read(abs)),
		list: (dir) => (read.push(dir), store.list(dir)),
		stat: (abs) => store.stat(abs)
	};
	return { fs, store, read };
}

/** A compile context for the app `at` describes, served (dev) or built. */
const ctx_of = (at: At, fs: Fs) => {
	const root = at.root ?? '/a/web';
	const is_build = at.is_build ?? true;
	return new CompileCtx(
		partial_ctx_init({
			root,
			base: at.base ?? '',
			app_dir: at.app_dir ?? '_app',
			kit_version: at.version === undefined ? '1700000000000' : at.version,
			libDir: `${root}/src/lib`,
			is_dev: !is_build,
			is_build,
			import_keys: normalize_import_keys(undefined),
			resolve_alias: [],
			presets: {},
			app_shims: {},
			fs
		})
	);
};
const compiler_for = (at: At, fs: Fs) =>
	new Compiler(
		new Program({ forms: true, router: true }),
		{ prof: {} as Compiler['profiler']['prof'], P: false, outHash: new Map() },
		ctx_of(at, fs)
	);
/** The identity the compiler makes for the app `at` describes. */
const id_of = (at: At = {}) => compiler_for(at, app_fs(at).fs).kit_env_build();

describe("the build's identity on Kit's env channel (KIT-PUBLIC-ENV)", () => {
	it('is the same in the server module and the browser reader of one app', () => {
		const build = id_of();
		expect(build).toMatch(ID_RE);
		expect(server_build(kit_public_env_module(3, build))).toBe(build);
		expect(server_build(kit_public_env_module(null, build))).toBe(build);
		expect(kit_env_reader_module('/rt/kit-env.js', build)).toContain(
			`read(${JSON.stringify(build)})`
		);
	});

	it('differs for another app: another package name, base or app dir', () => {
		const host = id_of();
		expect(id_of({ name: 'peer-app' })).not.toBe(host);
		expect(id_of({ base: '/peer' })).not.toBe(host);
		expect(id_of({ app_dir: '_peer' })).not.toBe(host);
	});

	it("changes with Kit's version.name: one app built at two times (Kit's default name) has two identities", () => {
		expect(id_of({ version: '1700000000001' })).not.toBe(id_of({ version: '1700000000000' }));
	});

	it('a pinned version.name gives one identity on every build of the app, whatever its source', () => {
		const pinned = { version: '4f3c2a1' };
		const first = id_of(pinned);
		const edited = { ...ISLAND_APP, 'src/lib/step.ts': 'export const step = 2;\n' };
		expect(id_of(pinned)).toBe(first);
		expect(id_of({ ...pinned, files: edited })).toBe(first);
	});

	it('reads no file of the source: editing any file, server-only, island or other, leaves it as it was', () => {
		const before = id_of();
		for (const [rel, text] of [
			['src/lib/server/db.ts', "export const db = { n: 1, key: 'hunter3' };\n"],
			['src/routes/+page.server.ts', 'export const load = () => ({ n: 2 });\n'],
			['src/lib/data.remote.ts', `// a comment\n${ISLAND_APP['src/lib/data.remote.ts']}`],
			['src/lib/step.ts', 'export const step = 2;\n'],
			['src/lib/Counter.svelte', COUNTER.replace('{n}', '[{n}]')],
			['src/routes/+page.svelte', '<h1>no island</h1>\n'],
			['src/env.js', 'export const variables = { PUBLIC_X: {} };\n']
		] as const)
			expect(id_of({ files: { ...ISLAND_APP, [rel]: text } }), rel).toBe(before);
		const { fs, read } = app_fs({});
		const compiler = compiler_for({}, fs);
		compiler.prescan();
		read.length = 0;
		compiler.kit_env_build();
		expect(read).toEqual(['/a/web/package.json']);
	});

	it('one app under two roots, built from two working folders, has one identity', () => {
		const at = (root: string, cwd: string) => {
			const was = process.cwd();
			process.chdir(cwd);
			try {
				return id_of({ root });
			} finally {
				process.chdir(was);
			}
		};
		const one = at('/a/web', '/');
		expect(one).toMatch(ID_RE);
		expect(at('/elsewhere/deep/web', '/')).toBe(one);
		expect(at('/a/web', tmpdir())).toBe(one);
	});

	it("is the same served and built: dev's identity is made from the same values", () => {
		expect(id_of({ is_build: false })).toBe(id_of({ is_build: true }));
	});

	it("a build makes its identity once, kept on the build its next leg's context carries on: both legs bear one", () => {
		const { fs, store } = app_fs({});
		const server = compiler_for({}, fs);
		const made = server.kit_env_build();
		store.set('/a/web/package.json', JSON.stringify({ name: 'renamed-mid-build' }));
		const client = server.with_ctx(ctx_of({}, fs));
		expect(client.kit_env_build()).toBe(made);
	});

	it('an app with no package.json, or one with no name, is named by its base, app dir and version.name', () => {
		const none = id_of({ name: null });
		expect(none).toMatch(ID_RE);
		expect(id_of({ name: null, version: '2' })).not.toBe(none);
		expect(
			id_of({ files: { ...ISLAND_APP, 'package.json': JSON.stringify({ private: true }) } })
		).toBe(id_of({ files: { ...ISLAND_APP, 'package.json': '{ not json' } }));
	});

	it("when Kit's version.name could not be read: made from the package name, base and app dir, and kit_env_version_unread says so once", () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { fs } = app_fs({});
			const compiler = compiler_for({ version: null }, fs);
			const id = compiler.kit_env_build();
			expect(id).toMatch(ID_RE);
			expect(compiler.kit_env_build()).toBe(id);
			const said = warned.mock.calls.map((c) => String(c[0]));
			expect(said.filter((s) => s.includes('kit_env_version_unread'))).toHaveLength(1);
			expect(id).not.toBe(id_of({ name: 'peer-app', version: null }));
			warned.mockClear();
			id_of();
			expect(warned).not.toHaveBeenCalled();
		} finally {
			warned.mockRestore();
		}
	});

	it('the identity is a digest: no value it is made of shows in it, and two apps whose values run together differ', () => {
		const at = { name: 'my-app', base: '/shop', app_dir: '_shop', version: 'abc1234' };
		const id = kit_env_build(at);
		expect(id).toMatch(ID_RE);
		for (const v of Object.values(at)) expect(id).not.toContain(v);
		expect(kit_env_build({ ...at, name: 'my-app\0/shop', base: '/b' })).not.toBe(
			kit_env_build({ ...at, name: 'my-app', base: '/shop\0/b' })
		);
	});
});
