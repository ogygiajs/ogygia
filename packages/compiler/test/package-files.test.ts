/**
 * `ogygia.files` — declared dependency compile surfaces. Discovery (package.json field →
 * realpath'd dirs/files, npm-"files"-style globs, escape refusal) + the CompileCtx gates it
 * feeds (in_declared_pkg membership, install-independent pkg_identity).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { discover_package_files } from '../src/vite/package-files.ts';
import { CompileCtx, type CompileCtxInit, type PackageScan } from '../src/ctx.ts';
import { Compiler } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { normalize_import_keys, type ImportKeys } from '../src/region/transform.ts';
import { dedent } from '@ogygia/core/contract';

let app: string;

/** A complete CompileCtxInit (minus pkg_scan) — shared by the gate + warning harnesses. */
const base_ctx_init = {
	root: '/repo',
	base: '',
	app_dir: '_app',
	libDir: '/repo/src/lib',
	measure: false,
	is_dev: false,
	id_salt: '',
	visibleMargin: undefined,
	presets: {},
	// no import keys at all: the island-hint matcher matches nothing (the harness overrides it)
	import_keys: {} as ImportKeys,
	resolve_alias: [],
	pkg_root: '/og',
	build_secret: 's',
	rate_limit: { max: 0, windowMs: 0 },
	session_cookie: '',
	region_ttl: 60,
	renew_window: 691200,
	router_enabled: true,
	router_view_transitions: true,
	runtime_dir: '/og/dist/runtime',
	runtime_hash: 'x',
	client_binding_stub_file: '/og/dist/c.js',
	app_shims: {},
	is_build: true,
	devtools: false
} satisfies Omit<CompileCtxInit, 'pkg_scan'>;

const write = (rel: string, content = '') => {
	const abs = path.join(app, rel);
	mkdirSync(path.dirname(abs), { recursive: true });
	writeFileSync(abs, content);
};

beforeAll(() => {
	app = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-pkg-files-')));
	write(
		'package.json',
		JSON.stringify({
			name: 'app',
			dependencies: { '@corp/ui': '1.0.0', plain: '1.0.0' },
			devDependencies: { 'dev-widgets': '1.0.0' }
		})
	);
	// declared: dir + glob + file + one missing entry
	write(
		'node_modules/@corp/ui/package.json',
		JSON.stringify({
			name: '@corp/ui',
			ogygia: {
				files: ['./src/components', './src/tables/**/*.ts', './src/entry.svelte', './nope']
			}
		})
	);
	write('node_modules/@corp/ui/src/components/Card.svelte');
	write('node_modules/@corp/ui/src/tables/admin.ts');
	write('node_modules/@corp/ui/src/tables/skip.js'); // glob is *.ts — must not match
	write('node_modules/@corp/ui/src/entry.svelte');
	// undeclared dependency — must never be touched
	write('node_modules/plain/package.json', JSON.stringify({ name: 'plain' }));
	write('node_modules/plain/src/Sneaky.svelte');
	// devDependency with a declaration — devDeps count too
	write(
		'node_modules/dev-widgets/package.json',
		JSON.stringify({ name: 'dev-widgets', ogygia: { files: ['./lib'] } })
	);
	write('node_modules/dev-widgets/lib/W.svelte');
});
afterAll(() => rmSync(app, { recursive: true, force: true }));

describe('discover_package_files', () => {
	it('finds ONLY declared packages, expands dirs/globs/files, skips missing entries', () => {
		const found = discover_package_files(app);
		expect(found.map((p) => p.name).sort()).toEqual(['@corp/ui', 'dev-widgets']);
		const ui = found.find((p) => p.name === '@corp/ui')!;
		expect(ui.dirs).toEqual([`${app}/node_modules/@corp/ui/src/components`]);
		expect(ui.files.sort()).toEqual([
			`${app}/node_modules/@corp/ui/src/entry.svelte`,
			`${app}/node_modules/@corp/ui/src/tables/admin.ts`
		]);
	});

	it('rejects a declaration that escapes the package', () => {
		write(
			'node_modules/@corp/ui/package.json',
			JSON.stringify({ name: '@corp/ui', ogygia: { files: ['../../../src'] } })
		);
		expect(() => discover_package_files(app)).toThrow(/escapes the package/);
		// restore for later tests
		write(
			'node_modules/@corp/ui/package.json',
			JSON.stringify({ name: '@corp/ui', ogygia: { files: ['./src/components'] } })
		);
	});

	it('rejects a malformed declaration loudly', () => {
		write(
			'node_modules/dev-widgets/package.json',
			JSON.stringify({ name: 'dev-widgets', ogygia: { files: './lib' } })
		);
		expect(() => discover_package_files(app)).toThrow(/must be an array/);
		write(
			'node_modules/dev-widgets/package.json',
			JSON.stringify({ name: 'dev-widgets', ogygia: { files: ['./lib'] } })
		);
	});
});

describe('CompileCtx gates', () => {
	// a pnpm-store-shaped root: version + peer hash in the path — the case that breaks
	// root-relative identities
	const store = '/repo/node_modules/.pnpm/@corp+ui@1.2.3_svelte@5.0.0/node_modules/@corp/ui';
	const scan: PackageScan[] = [
		{
			name: '@corp/ui',
			root: store,
			dirs: [`${store}/src/components`],
			files: [`${store}/src/tables/admin.ts`]
		}
	];
	const ctx = new CompileCtx({ ...base_ctx_init, pkg_scan: scan });

	it('in_declared_pkg: declared file + files under declared dirs; nothing else', () => {
		expect(ctx.in_declared_pkg(`${store}/src/tables/admin.ts`)).toBe(true);
		expect(ctx.in_declared_pkg(`${store}/src/components/deep/Card.svelte`)).toBe(true);
		expect(ctx.in_declared_pkg(`${store}/src/undeclared/X.svelte`)).toBe(false);
		expect(ctx.in_declared_pkg('/repo/src/App.svelte')).toBe(false);
		// windows separators normalize
		expect(ctx.in_declared_pkg(`${store}/src/components/Card.svelte`.replace(/\//g, '\\'))).toBe(
			true
		);
	});

	it('pkg_identity: install-independent `<name>/<rel>` under the declared root', () => {
		expect(ctx.pkg_identity(`${store}/src/components/Card.svelte`)).toBe(
			'@corp/ui/src/components/Card.svelte'
		);
		// NOT under a declared root → null (caller falls back to root-relative)
		expect(ctx.pkg_identity('/repo/src/App.svelte')).toBeNull();
	});

	it('a sibling package whose root is a STRING prefix does not leak into matches', () => {
		// /store/pkg vs /store/pkg-extra — startsWith without the '/' would cross-match
		const a = '/nm/.pnpm/x@1/node_modules/pkg';
		const b = '/nm/.pnpm/y@1/node_modules/pkg-extra';
		const c2 = new CompileCtx({
			...base_ctx_init,
			pkg_scan: [
				{ name: 'pkg', root: a, dirs: [`${a}/src`], files: [] },
				{ name: 'pkg-extra', root: b, dirs: [`${b}/src`], files: [] }
			]
		});
		expect(c2.pkg_identity(`${b}/src/X.svelte`)).toBe('pkg-extra/src/X.svelte');
		expect(c2.in_declared_pkg(`${b}/srcX/evil.ts`)).toBe(false); // dir prefix needs the '/'
	});
});

describe('undeclared-marks warning', () => {
	const make = (pkg_root: string) => {
		const program = new Program({ forms: true, router: true });
		const profiler = {
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
		};
		const compiler = new Compiler(
			program,
			profiler,
			new CompileCtx({
				...base_ctx_init,
				root: '/nowhere-app',
				libDir: '/nowhere-app/src/lib',
				import_keys: normalize_import_keys(undefined),
				pkg_root
			})
		);
		return compiler;
	};
	const noop_emit = () => '';
	/** A server-leg transform of `c`. */
	const on_server = (c: Compiler) => {
		c.start_leg('ssr', true);
		return { leg: c.leg({ name: 'ssr', server: true }), emitFile: noop_emit };
	};
	const marked = `${dedent`
		import W from './W.svelte' with { wake: 'load' };
		export const t = W;
	`}\n`;

	it('a dependency .ts with marks but NO declaration warns loudly (was silent death)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const c = make('/nowhere/ogygia');
		await c.transform_module(
			marked,
			'/nowhere-app/node_modules/sneaky/dist/routes.js',
			on_server(c)
		);
		expect(warn.mock.calls.flat().join('\n')).toMatch(/declares no.*ogygia.*files/s);
		warn.mockRestore();
	});

	it('a dependency that only MENTIONS a mark (comment, string, error text) does not warn', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const c = make('/nowhere/ogygia');
		await c.transform_module(
			dedent`
				/** A \`with { render: 'deferred', stitch: 'serve' }\` hole ships as a normal one. */
				export const fix = \`import X from './X.svelte' with { wake: 'load' };\`;
				export function fail() { throw new Error("mark its import (\`with { region: 'raw' }\`)"); }
			`,
			'/nowhere-app/node_modules/@ogygia/plugin/dist/stitch.js',
			on_server(c)
		);
		expect(warn.mock.calls.flat().join('\n')).not.toMatch(/declares no/);
		warn.mockRestore();
	});

	it("ogygia's OWN modules are exempt (compiler sources CONTAIN `with { wake` as strings)", async () => {
		const og_root = '/consumer/node_modules/ogygia';
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const c = make(og_root);
		await c.transform_module(
			`const RE = /\\bwith\\s*\\{[^}]*\\bwake\\b/; export const s = "with { wake: 'load' }";\n`,
			`${og_root}/dist/region/transform.js`,
			on_server(c)
		);
		expect(warn.mock.calls.flat().join('\n')).not.toMatch(/declares no/);
		warn.mockRestore();
	});
});

describe('discover_package_files: what counts as a declaration', () => {
	const fresh = (files: Record<string, string>) => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-pkg-decl-')));
		for (const [rel, content] of Object.entries(files)) {
			mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
			writeFileSync(path.join(root, rel), content);
		}
		return root;
	};

	it("ogygia's own packages are never read through the field", () => {
		const root = fresh({
			'package.json': JSON.stringify({ dependencies: { '@ogygia/core': '1' } }),
			'node_modules/@ogygia/core/package.json': JSON.stringify({ ogygia: { files: ['./ui'] } }),
			'node_modules/@ogygia/core/ui/P.svelte': ''
		});
		expect(discover_package_files(root)).toEqual([]);
		rmSync(root, { recursive: true, force: true });
	});

	it('every glob form expands: braces and classes as well as stars', () => {
		const root = fresh({
			'package.json': JSON.stringify({ dependencies: { kit: '1' } }),
			'node_modules/kit/package.json': JSON.stringify({
				ogygia: { files: ['./src/{one,two}.ts', './src/[x]y.ts'] }
			}),
			'node_modules/kit/src/one.ts': '',
			'node_modules/kit/src/two.ts': '',
			'node_modules/kit/src/xy.ts': ''
		});
		const [kit] = discover_package_files(root);
		expect(kit.files.map((f) => path.basename(f)).sort()).toEqual(['one.ts', 'two.ts', 'xy.ts']);
		rmSync(root, { recursive: true, force: true });
	});
});
