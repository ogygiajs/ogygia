// The virtual-module table (src/compiler/virtual/): every id an app's build asks for resolved and
// loaded on both legs, in a build and on the dev server, the way the Vite plugin drives it; and
// the dev invalidations a change sets off.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bench } from '@bench/heisenbench/bench';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx, type CompileCtxInit } from '../src/compiler/ctx.ts';
import { set_host, type HostFs } from '../src/compiler/host.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { CORE_VIRTUALS } from '../src/compiler/virtual/core.ts';
import { VirtualTable } from '../src/compiler/virtual/resolver.ts';
import { specifier, virtual } from '../src/compiler/virtual/table.ts';

const ROOT = '/app';

/** A small app in memory: one csr=false page, one csr=true page, the layout between. */
const FILES: Record<string, string> = {
	'/app/src/routes/+layout.ts': 'export const csr = false;\n',
	'/app/src/routes/+page.svelte': '<h1>home</h1>\n',
	'/app/src/routes/shop/+page.ts': 'export const csr = true;\n',
	'/app/src/routes/shop/+page.svelte': '<h1>shop</h1>\n'
};
const is_dir = (p: string): boolean => Object.keys(FILES).some((f) => f.startsWith(p + '/'));
const entry = (dir: string, name: string) => ({
	name,
	isDirectory: () => is_dir(dir + '/' + name),
	isFile: () => dir + '/' + name in FILES
});
const memory_fs = {
	readFileSync(p: string): string {
		if (p in FILES) return FILES[p];
		throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
	},
	existsSync: (p: string) => p in FILES || is_dir(p),
	readdirSync(p: string, opts?: { withFileTypes?: boolean }) {
		const names = new Set<string>();
		for (const f of Object.keys(FILES))
			if (f.startsWith(p + '/')) names.add(f.slice(p.length + 1).split('/')[0]);
		return opts?.withFileTypes ? [...names].map((n) => entry(p, n)) : [...names];
	},
	statSync: (p: string) => ({ isDirectory: () => is_dir(p), isFile: () => p in FILES }),
	globSync: () => [],
	writeFileSync() {},
	mkdirSync() {},
	rmSync() {},
	renameSync() {}
} as unknown as HostFs;

function compiler(root: string, is_dev: boolean): Compiler {
	const c = new Compiler(new Program({ forms: true, router: true }), {
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
		outHash: new Map()
	});
	const init: Partial<CompileCtxInit> = {
		root,
		base: '/',
		libDir: `${root}/src/lib`,
		is_dev,
		is_build: !is_dev,
		id_salt: '',
		visibleMargin: '0px',
		presets: {},
		import_keys: normalize_import_keys(undefined),
		resolve_alias: [],
		pkg_root: '/nowhere/ogygia',
		build_secret: 'k',
		rate_limit: { max: 60, windowMs: 60000 },
		session_cookie: 'sid',
		region_ttl: 3600,
		renew_window: 0,
		router_enabled: true,
		router_view_transitions: false,
		runtime_dir: '/nowhere/ogygia/dist/runtime',
		runtime_hash: 'h',
		hmac_module: '/nowhere/ogygia/dist/server/hmac.js',
		region_endpoint_module: '/nowhere/ogygia/dist/server/region-endpoint.js',
		kit_wire_path: '/nowhere/kit/shared.js',
		client_binding_stub_file: '/nowhere/stub.js',
		app_shims: {},
		client_plugins: ['/nowhere/plugin/client.js'],
		server_plugins: [{ name: 'p', module: '/nowhere/plugin/server.js', options: {} }],
		measure: true,
		devtools: false
	};
	c.configure(new CompileCtx(init as CompileCtxInit));
	// what a build's transforms leave for the generated modules: an og.$ factory, a transportable class
	c.dollar_hoists.set('og$0', '() => 1');
	c.program.transportable_modules.add(`${root}/src/lib/money.ts`);
	return c;
}

/** Every module id the table answers, by its realm-named specifier and its alias. */
const SPECIFIERS = CORE_VIRTUALS.flatMap((e) =>
	e.kind === 'constant' || (e.kind === 'family' && e.parse)
		? []
		: [specifier(e.realm, e.id), ...(e.alias ? [e.alias] : [])]
);

bench(
	'virtual modules: every id resolved and loaded, both legs, a build and the dev server',
	async ({ root }) => {
		let bytes = 0;
		for (const is_dev of [false, true]) {
			const c = compiler(root, is_dev);
			for (const source of SPECIFIERS) {
				const id = await c.resolve_id(source, undefined, {
					ssr: true,
					resolve: async () => null
				});
				if (typeof id !== 'string' || !id.startsWith('\0')) continue;
				for (const ssr of [true, false]) {
					const out = await c.emit(id, { ssr, universalHooks: null, resolve: async () => null });
					bytes += out?.length ?? 0;
				}
			}
			// a family member by its prefix
			const stub = await c.resolve_id(
				'virtual:ogygia/registry-stub/a.js?names=default,b',
				undefined,
				{
					ssr: false,
					resolve: async () => null
				}
			);
			bytes += ((await c.emit(stub as string, { ssr: false, universalHooks: null })) ?? '').length;
			for (const w of ['regions', 'routes', 'styles', 'options', 'plugins'] as const)
				bytes += c.watching(w).length;
		}
		return bytes;
	},
	{
		setup: () => {
			set_host({ fs: memory_fs, path, crypto: { createHash } });
			return { root: ROOT };
		}
	}
);

bench('virtual modules: a table built, an undeclared id and a duplicate refused', () => {
	let refused = 0;
	const table = new VirtualTable(CORE_VIRTUALS);
	for (const id of ['virtual:ogygia/nope', 'ogygia:server/nope']) {
		try {
			table.resolve(id);
		} catch {
			refused++;
		}
	}
	const a = virtual.value({ realm: 'server', id: 'x', from: () => ({}) });
	const b = virtual.constant({ id: '__X__', from: () => true });
	try {
		new VirtualTable([a, a, b]);
	} catch {
		refused++;
	}
	return refused + (table.claims('virtual:ogygia/island/a.js') ? 1 : 0);
});
