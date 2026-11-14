import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VirtualTable } from '../src/virtual/resolver.ts';
import { queries } from '../src/queries.ts';
import {
	CORE_PARTS,
	CORE_VIRTUALS,
	core_path,
	type CoreApp
} from '../src/virtual/core.ts';
import type { Leg } from '../src/virtual/table.ts';
import { CORE_VALUE_NAMES } from '../src/virtual/value-names.ts';

const table = new VirtualTable<CoreApp>(
	CORE_VIRTUALS,
	core_path,
	CORE_VALUE_NAMES,
	CORE_PARTS,
	queries('session')
);

type Fake = {
	ctx?: Record<string, unknown>;
	program?: Record<string, unknown>;
	client?: { name: string; module: string }[];
	hoists?: Map<string, string>;
	calls?: string[];
};

function app(f: Fake = {}): CoreApp {
	const calls = f.calls ?? [];
	return {
		ctx: { runtime_dir: '/pkg/dist/runtime', root: '/app', ...f.ctx },
		program: {
			runtime_marks: {},
			crosses_wire: false,
			transportable_modules: [],
			by_id: new Map(),
			registry: new Map(),
			ship_runtime: () => {
				calls.push('ship_runtime');
				return {};
			},
			...f.program
		},
		dollar_hoists: f.hoists ?? new Map(),
		prescan: () => calls.push('prescan'),
		runtime_chunk_url: () => {
			calls.push('runtime_chunk_url');
			return '/_app/immutable/runtime.js';
		},
		region_names: () => ({ r1: 'Counter' }),
		router_css_roots: () => [],
		routes_dir: () => '/app/src/routes',
		plugins: () => ({ server: [], client: f.client ?? [], route_config: [] })
	} as unknown as CoreApp;
}

const leg = (ssr: boolean): Leg => ({ ssr, universalHooks: null });
const load = (spec: string, a: CoreApp, ssr = false) =>
	table.load(table.resolve(spec)!, a, leg(ssr)) as string | null;
const DEV = { is_dev: true, is_build: false };
const BUILD = { is_dev: false, is_build: true };
const PLUGIN = { name: 'x-plugin', module: '/plugins/x/client.js' };

describe('core’s boot modules', () => {
	it('the dev boot calls bootDev, so a sideEffects:false package is not tree-shaken out of it', () => {
		expect(load('ogygia:boot/runtime', app({ ctx: DEV }))).toContain('bootDev();');
	});

	it('runs the app’s client hooks from the boot, and adds nothing for an app without them', () => {
		const hooks = load(
			'ogygia:boot/runtime',
			app({ ctx: { client_hooks: '/app/hooks.client.ts' } })
		);
		expect(hooks).toContain('from "/pkg/dist/runtime/client-hooks.js"');
		expect(hooks).toContain('__og_run_client_hooks(() => import("/app/hooks.client.ts"));');
		expect(load('ogygia:boot/runtime', app())).not.toContain('client-hooks');
	});

	it('registers og.$ factories from the hoists in dev, and leaves a placeholder for renderChunk in a build', () => {
		const hoists = new Map([['t1', '() => 1']]);
		const dev = load('ogygia:boot/fn-manifest', app({ ctx: DEV, hoists }))!;
		expect(dev).toContain('globalThis.__og_reg_fn = __register_fn;');
		expect(dev).toContain('"t1"');
		const build = load('ogygia:boot/fn-manifest', app({ ctx: BUILD, hoists }))!;
		expect(build.endsWith('/*__OGYGIA_FN_MANIFEST__*/')).toBe(true);
		expect(build).not.toContain('"t1"');
	});

	it('picks the boot entry’s features only after every host is prescanned', () => {
		const calls: string[] = [];
		load('ogygia:boot/runtime-entry', app({ ctx: BUILD, calls }));
		expect(calls).toEqual(['prescan', 'ship_runtime']);
	});

	it('turns every runtime flag on in dev, and in a build only the ones its marks need', () => {
		const dev = load('ogygia:boot/runtime-flags', app({ ctx: DEV }))!;
		expect(dev).toContain('FRAMES = true');
		expect(dev).toContain('load_wire_codec = null');
		const program = { runtime_marks: { complete: true } };
		const build = load('ogygia:boot/runtime-flags', app({ ctx: BUILD, program }))!;
		expect(build).toContain('FRAMES = false');
		expect(build).toContain('load_wire_codec = () => import(');
	});

	it('installs every hydrate feature in dev, from the runtime the app resolves (a workspace’s .ts source)', () => {
		const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'og-devrt-'));
		fs.mkdirSync(path.join(pkg, 'src/runtime'), { recursive: true });
		fs.writeFileSync(path.join(pkg, 'src/runtime/index.ts'), '');
		fs.writeFileSync(
			path.join(pkg, 'package.json'),
			JSON.stringify({ exports: { './runtime': { default: './src/runtime/index.ts' } } })
		);
		const ws = load(
			'ogygia:boot/hydrate-features',
			app({ ctx: { ...DEV, runtime_dir: path.join(pkg, 'dist/runtime') } })
		)!;
		expect(ws).toContain(`"${path.join(pkg, 'src/runtime')}/`);
		expect(ws).toContain('.ts";');
		expect(ws).not.toContain('.js";');
		expect(ws).not.toContain('dist/runtime');
		const published = load(
			'ogygia:boot/hydrate-features',
			app({ ctx: { ...DEV, runtime_dir: path.join(pkg, 'none/dist/runtime') } })
		)!;
		expect(published).toContain('none/dist/runtime/');
		expect(published).toContain('.js";');
		fs.rmSync(pkg, { recursive: true });
	});

	it('installs every hydrate feature in dev from the runtime directory as given when its package.json is not JSON', () => {
		const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'og-devrt-'));
		fs.writeFileSync(path.join(pkg, 'package.json'), '{ "exports": ');
		const code = load(
			'ogygia:boot/hydrate-features',
			app({ ctx: { ...DEV, runtime_dir: path.join(pkg, 'dist/runtime') } })
		)!;
		expect(code).toContain(`"${path.join(pkg, 'dist/runtime')}/`);
		expect(code).toContain('.js";');
		fs.rmSync(pkg, { recursive: true });
	});

	it('imports the og.$ manifest in a build only when a decoder can revive a fn ref (wire, context, Kit transport)', () => {
		const with_ = (program: Record<string, unknown>) =>
			load('ogygia:boot/hydrate-features', app({ ctx: BUILD, program }))!.includes('fn-manifest');
		expect(with_({})).toBe(false);
		expect(with_({ runtime_marks: { wire: true } })).toBe(true);
		expect(with_({ runtime_marks: { context: true } })).toBe(true);
		expect(with_({ crosses_wire: true })).toBe(true);
	});

	it('re-exports the hydrate features after the runtime flags, which the runtime they import reads back', () => {
		const boot = load('ogygia:boot', app())!;
		expect(boot.indexOf('ogygia:boot/runtime-flags')).toBeGreaterThan(-1);
		expect(boot.indexOf('ogygia:boot/hydrate-features')).toBeGreaterThan(
			boot.indexOf('ogygia:boot/runtime-flags')
		);
	});

	it('names every region’s component for devtools in a build, and none in dev (the dev server serves them)', () => {
		expect(load('ogygia:boot/devtools-meta', app({ ctx: DEV }))).toBe(
			'export const region_names = {  };'
		);
		const calls: string[] = [];
		expect(load('ogygia:boot/devtools-meta', app({ ctx: BUILD, calls }))).toContain('"Counter"');
		expect(calls).toEqual(['prescan']);
	});
});

describe('core’s region modules', () => {
	it('loads transportable classes eagerly on the server, and as lazy loaders by root-relative tag in the browser', () => {
		const program = { transportable_modules: ['/app/src/lib/money.ts'] };
		expect(load('ogygia:region/transportables', app({ program }), true)).toContain(
			'import "/app/src/lib/money.ts";'
		);
		const browser = load('ogygia:region/transportables', app({ program }), false)!;
		expect(browser).toContain('src/lib/money.ts');
		expect(browser).not.toContain('"/app/src/lib/money.ts":');
	});

	it('gives a region entry its codecs eagerly on the server, and nothing in the browser', () => {
		const program = { transportable_modules: ['/app/src/lib/money.ts'] };
		expect(load('ogygia:region/transportables-eager', app({ program }), false)).toBe(
			'export {};\n'
		);
		expect(load('ogygia:region/transportables-eager', app({ program }), true)).toContain(
			'import "/app/src/lib/money.ts";'
		);
	});

	it('serves Kit’s transport the codec cluster only when the app crosses a region or wired value over it', () => {
		const t = (program: Record<string, unknown>, ssr: boolean) =>
			load('ogygia:region/kit-transport', app({ program }), ssr);
		expect(t({}, true)).toBe('export const transport = {};');
		expect(t({ runtime_marks: { wire: true } }, false)).toContain(
			'/pkg/dist/runtime/../transport.js'
		);
		expect(t({ crosses_wire: true }, true)).toContain('/pkg/dist/runtime/../server/transport.js');
	});
});

describe('core’s dev modules', () => {
	it('serves the soft HMR bridge in dev only', () => {
		expect(load('ogygia:dev/hmr', app({ ctx: DEV }))).toContain('/@vite/client');
		expect(load('ogygia:dev/hmr', app({ ctx: BUILD }))).toBe('export {}');
	});

	it('boots the plugins’ browser halves on a Kit page, after Vite’s env module in dev', () => {
		expect(load('ogygia:dev/devtools-boot', app({ ctx: DEV }))).toBe('export {}');
		const dev = load('ogygia:dev/devtools-boot', app({ ctx: DEV, client: [PLUGIN] }))!;
		expect(dev.startsWith(`import '/@vite/env';\n`)).toBe(true);
		expect(dev).toContain(
			'boot_client_plugins([{ name: "x-plugin", client: __og_client_0 }], true);'
		);
		expect(load('ogygia:dev/devtools-boot', app({ ctx: BUILD, client: [PLUGIN] }))).not.toContain(
			'/@vite/env'
		);
	});
});

describe('core’s server modules', () => {
	it('names the runtime by its dev URL in dev, and in a build by its chunk once every host is prescanned', () => {
		expect(load('ogygia:server/runtime-url', app({ ctx: DEV }), true)).toBe(
			'export const runtime_url = "/@id/__x00__ogygia:boot/runtime";'
		);
		const calls: string[] = [];
		load('ogygia:server/runtime-url', app({ ctx: BUILD, calls }), true);
		expect(calls).toEqual(['prescan', 'runtime_chunk_url']);
	});

	it('hands csr=true pages the devtools boot URL only in dev with a plugin browser half', () => {
		const url = (ctx: Record<string, unknown>, client: (typeof PLUGIN)[]) =>
			load('ogygia:server/devtools-boot-url', app({ ctx, client }), true);
		expect(url(DEV, [PLUGIN])).toBe(
			'export const devtools_boot_url = "/@id/__x00__ogygia:dev/devtools-boot";'
		);
		expect(url(DEV, [])).toBe('export const devtools_boot_url = "";');
		expect(url(BUILD, [PLUGIN])).toBe('export const devtools_boot_url = "";');
	});

	it('gives the build’s key only to the server leg, and says whether an OGYGIA_SECRET salted its ids', () => {
		const s = (ctx: Record<string, unknown>, ssr: boolean) =>
			load('ogygia:server/secret', app({ ctx }), ssr);
		expect(s({ build_secret: 'k', id_salt: 'salt' }, true)).toContain('build_had_secret = true');
		expect(s({ build_secret: 'k', id_salt: '' }, true)).toContain('build_had_secret = false');
		expect(() => s({ build_secret: 'k', id_salt: 'salt' }, false)).toThrow(/virtual_wrong_realm/);
	});

	it('re-exports Kit’s own wire codec from its absolute path, and leaves the id to the bundler without one', () => {
		expect(load('ogygia:server/kit-wire', app({ ctx: { kit_wire_path: null } }), true)).toBeNull();
		expect(
			load('ogygia:server/kit-wire', app({ ctx: { kit_wire_path: '/kit/remote.js' } }), true)
		).toContain('from "/kit/remote.js"');
	});

	it('keeps the server’s rate limit, session cookie and profiler maps off the browser leg', () => {
		const ctx = {
			...BUILD,
			measure: true,
			rate_limit: { max: 5, windowMs: 1000 },
			session_cookie: 'sid'
		};
		for (const id of [
			'ogygia:server/rate-limit',
			'ogygia:server/session-cookie',
			'ogygia:server/profiler-maps'
		])
			expect(() => load(id, app({ ctx }), false), id).toThrow(/virtual_wrong_realm/);
		expect(load('ogygia:server/rate-limit', app({ ctx }), true)).toContain('"max": 5');
		expect(load('ogygia:server/session-cookie', app({ ctx }), true)).toContain('"sid"');
		expect(load('ogygia:server/profiler-maps', app({ ctx }), true)).not.toContain('null');
		expect(load('ogygia:server/profiler-maps', app({ ctx: { ...ctx, ...DEV } }), true)).toContain(
			'null'
		);
	});

	it('prescans before writing the server manifest, in dev and in a build', () => {
		for (const ctx of [DEV, BUILD]) {
			const calls: string[] = [];
			const a = app({ ctx: { ...ctx, dev_url_for: (p: string) => p }, calls });
			load('ogygia:server/server-manifest', a, true);
			expect(calls).toEqual(['prescan']);
		}
	});

	it('marks the regions the build’s server-regions module wrote, so a later one is a late region', () => {
		const a = app({ ctx: BUILD });
		load('ogygia:server/server-regions', a, true);
		expect((a.program as unknown as Record<string, unknown>).server_regions_written).toBeInstanceOf(
			Set
		);
	});
});
