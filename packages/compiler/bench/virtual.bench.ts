// The virtual-module table (src/compiler/virtual/): every id an app's build asks for resolved and
// loaded on both legs, in a build and on the dev server, the way the Vite plugin drives it; and
// the dev invalidations a change sets off.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bench } from '@bench/heisenbench/bench';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx, type CompileCtxInit } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import * as core from '../src/compiler/virtual/core.ts';
import {
	CORE_PARTS,
	CORE_VIRTUALS,
	core_defines,
	core_path,
	type ConstantInput
} from '../src/compiler/virtual/core.ts';
import {
	constant_types,
	probe_value_names,
	value_names_source,
	virtual_types
} from '../src/compiler/virtual/types.ts';
import { CORE_VALUE_NAMES } from '../src/compiler/virtual/value-names.ts';
import { VirtualTable } from '../src/compiler/virtual/resolver.ts';
import { derived, input, queries } from '../src/compiler/queries.ts';
import { BUILD_ERRORS } from '../src/compiler/messages.ts';
import { specifier, virtual, type Realm } from '../src/compiler/virtual/table.ts';

/** A small app on disk: one csr=false page, one csr=true page, the layout between. */
const FILES: Record<string, string> = {
	'src/routes/+layout.ts': 'export const csr = false;\n',
	'src/routes/+page.svelte': '<h1>home</h1>\n',
	'src/routes/shop/+page.ts': 'export const csr = true;\n',
	'src/routes/shop/+page.svelte': '<h1>shop</h1>\n'
};

/** The app written to a fixed temporary directory (the compiler reads node:fs directly): fixed, as
 *  Heisenbench replays the reads it recorded by their path. */
function write_app(): string {
	const dir = path.join(os.tmpdir(), 'og-virtual-bench');
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const root = fs.realpathSync(dir);
	for (const [rel, text] of Object.entries(FILES)) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), text);
	}
	return root;
}

function compiler(root: string, is_dev: boolean): Compiler {
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
		kit_wire_path: '/nowhere/kit/shared.js',
		client_binding_stub_file: '/nowhere/stub.js',
		app_shims: {},
		client_plugins: [{ name: 'p', module: '/nowhere/plugin/client.js' }],
		server_plugins: [{ name: 'p', module: '/nowhere/plugin/server.js', options: {} }],
		measure: true,
		devtools: false
	};
	const c = new Compiler(
		new Program({ forms: true, router: true }),
		{
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
			outHash: new Map()
		},
		new CompileCtx(init as CompileCtxInit)
	);
	// what a build's transforms leave for the generated modules: an og.$ factory, a transportable class
	c.dollar_hoists.set('og$0', '() => 1');
	c.program.scan.set(`${root}/src/lib/money.ts`, {
		crosses_wire: false,
		transportable: true,
		specs: [],
		router: false
	});
	return c;
}

/** Every module id the table answers, by its realm-named specifier, with its realm. */
const SPECIFIERS: [string, Realm][] = [
	['ogygia:server', 'server'],
	['ogygia:boot', 'boot'],
	['ogygia:region', 'region'],
	...CORE_VIRTUALS.flatMap((e): [string, Realm][] =>
		e.kind === 'constant' || (e.kind === 'family' && e.parse)
			? []
			: [[specifier(e.realm, e.id), e.realm]]
	)
];
/** A module's realm imports, as an app's code writes them. */
const IMPORTS = `import { region_ttl, renew_window, sign, region_css as css } from 'ogygia:server';
import { FRAMES, transport } from 'ogygia:boot';
export { kit_transport as transport } from 'ogygia:region';`;
const size = (out: string | { code: string } | null): number =>
	out === null ? 0 : typeof out === 'string' ? out.length : out.code.length;

bench(
	'virtual modules: every id resolved and loaded, both legs, a build and the dev server',
	async ({ root }) => {
		let bytes = 0;
		for (const is_dev of [false, true]) {
			const c = compiler(root, is_dev);
			const ids: string[] = [];
			for (const [source, realm] of SPECIFIERS) {
				// resolved on a leg its realm may be imported from (the realm check refuses the others)
				if (realm === 'dev' && !is_dev) continue;
				const id = await c.resolve_id(source, undefined, {
					ssr: realm === 'server' || realm === 'region',
					resolve: async () => null
				});
				if (typeof id !== 'string' || !id.startsWith('\0')) continue;
				ids.push(id);
				for (const ssr of [true, false]) {
					bytes += size(await c.emit(id, { ssr, universalHooks: null, resolve: async () => null }));
				}
			}
			// a family member by its prefix
			const stub = await c.resolve_id(
				'ogygia:region/registry-stub/a.js?names=default,b',
				undefined,
				{
					ssr: false,
					resolve: async () => null
				}
			);
			bytes += size(await c.emit(stub as string, { ssr: false, universalHooks: null }));
			// the bundle check over each leg's output: table modules, a family member, an app file
			ids.push(stub as string, `${root}/src/routes/+page.svelte`);
			if (!is_dev) for (const ssr of [true, false]) bytes += c.misplaced_modules(ids, ssr).length;
			bytes += c.split_realm_imports(IMPORTS)?.length ?? 0;
			for (const part of ['regions', 'routes', 'styles', 'options', 'plugins'] as const)
				bytes += c.changed(part).length;
		}
		return bytes;
	},
	{
		setup: () => ({ root: write_app() })
	}
);

bench('virtual modules: a table built, an undeclared id and a duplicate refused', () => {
	let refused = 0;
	const db = queries('session');
	const table = new VirtualTable(CORE_VIRTUALS, core_path, CORE_VALUE_NAMES, CORE_PARTS, db);
	for (const id of ['ogygia:region/nope/x.js', 'ogygia:server/nope']) {
		try {
			table.resolve(id);
		} catch {
			refused++;
		}
	}
	const a = virtual.value({ realm: 'server', id: 'x', from: () => ({}) });
	const b = virtual.constant({ id: '__X__', from: () => true });
	try {
		new VirtualTable([a, a, b], core_path, { 'ogygia:server/x': [] }, CORE_PARTS, db);
	} catch {
		refused++;
	}
	// a value module without generated names, and its message as the docs page words it
	try {
		new VirtualTable([a], core_path, {}, CORE_PARTS, db);
	} catch (e) {
		refused += String(e).length > 0 ? 1 : 0;
	}
	refused += BUILD_ERRORS.virtual_names_stale.details().length;
	refused += BUILD_ERRORS.virtual_names_stale.text({ id: 'ogygia:server/x' }).length;
	return refused + (table.claims('ogygia:region/entry/a.js') ? 1 : 0);
});

bench('virtual modules: dev moves, each followed by the modules that moved', () => {
	// fifty modules, each reading a part and one of ten folds; edits move a fold or a part
	const db = queries('session');
	const size = input<string, number>(
		'size',
		(f) => f,
		() => 0
	);
	const folds = Array.from({ length: 10 }, (_, i) =>
		derived<string, number>(
			`fold ${i}`,
			() => 'all',
			(cx) => cx.get(size, `f${i}`) % 3
		)
	);
	const entries = Array.from({ length: 50 }, (_, i) =>
		virtual.family<{ program: number }>({
			realm: 'server',
			id: `m${i}`,
			load: (app) => `export const v = ${app.program + db.get(folds[i % 10], 'all')};`
		})
	);
	const table = new VirtualTable(entries, () => '', {}, { program: 'regions' }, db);
	const app = { program: 1 };
	const leg = { ssr: true, universalHooks: null };
	let named = 0;
	for (let edit = 0; edit < 40; edit++) {
		for (let i = 0; i < 50; i++)
			// oxlint-disable-next-line typescript/no-floating-promises -- the bench counts load's own steps; these modules answer at once (test: virtual-reads.test.ts load_now)
			table.load(`\0ogygia:server/m${i}`, app, leg);
		if (edit % 4 === 0) table.move('regions');
		else db.set(size, `f${edit % 10}`, edit);
		named += table.moved().length;
	}
	return named;
});

bench('virtual constants: the define map of two option sets, and their generated globals', () => {
	const base: ConstantInput = {
		continuity_forms: false,
		server_delta: false,
		devtools: false,
		devtools_lazy: false,
		rules: false,
		client_plugins: false,
		hooks: [],
		kit_major: null,
		version: '0.0.0',
		dev_server: false
	};
	const on: ConstantInput = {
		continuity_forms: true,
		server_delta: true,
		devtools: true,
		devtools_lazy: true,
		rules: true,
		client_plugins: true,
		hooks: ['regionMount', 'regionHydrated', 'navigated'],
		kit_major: 3,
		version: '1.2.3',
		dev_server: true
	};
	let n = 0;
	for (const input of [base, on]) n += Object.keys(core_defines(input)).length;
	return n + constant_types(core).length;
});

bench('virtual types: the value names probed, and each realm’s .d.ts, generated off the table', () => {
	const names = probe_value_names(core.CORE_VIRTUALS, core.CORE_PROBE.app, core.CORE_PROBE.leg);
	let n = value_names_source(names).length;
	for (const text of Object.values(virtual_types(core, names))) n += text.length;
	return n;
});
