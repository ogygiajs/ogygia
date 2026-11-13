/**
 * The virtual-module table (src/compiler/virtual/): every module ogygia serves is declared once, an
 * undeclared id in the namespace fails with a code, every module answers to its realm-named
 * specifier only, and a dev change invalidates exactly the entries that watch it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VirtualTable } from '../src/compiler/virtual/resolver.ts';
import { queries } from '../src/compiler/queries.ts';
import { route_reader } from '../src/compiler/kit.ts';
import { node_fs } from '../src/compiler/fs.ts';
import {
	CORE_PARTS,
	CORE_VIRTUALS,
	core_path,
	type CoreApp
} from '../src/compiler/virtual/core.ts';
import { virtual, write_value, type Leg, type Part } from '../src/compiler/virtual/table.ts';
import {
	RESOLVED,
	V_FN_MANIFEST,
	V_RUNTIME_ENTRY,
	V_SERVER_MANIFEST,
	V_SERVER_REGIONS,
	V_TRANSPORT,
	V_TRANSPORTABLES,
	islandVirtualId,
	lazyEntryVirtualId,
	regionBindingVirtualId,
	region_family,
	wrapperVirtualId
} from '../src/compiler/ids.ts';
import { BUILD_ERRORS } from '../src/compiler/messages.ts';
import { CORE_VALUE_NAMES } from '../src/compiler/virtual/value-names.ts';
import { dedent } from '@ogygia/core/plugin/utils';

const table = new VirtualTable<CoreApp>(
	CORE_VIRTUALS,
	core_path,
	CORE_VALUE_NAMES,
	CORE_PARTS,
	queries('session')
);
const app = (ctx: Partial<CoreApp['ctx']>): CoreApp => ({ ctx }) as unknown as CoreApp;
const leg = (ssr: boolean): Leg => ({ ssr, universalHooks: null });

describe('the virtual-module table', () => {
	it('resolves a realm-named specifier, and leaves the old virtual:ogygia/* ids to the bundler', () => {
		expect(table.resolve('ogygia:server/secret')).toBe(RESOLVED('ogygia:server/secret'));
		expect(table.resolve('virtual:ogygia/secret')).toBeUndefined();
	});

	it('answers every id the code outside the table names (ids.ts)', () => {
		for (const id of [
			V_RUNTIME_ENTRY,
			V_FN_MANIFEST,
			V_SERVER_MANIFEST,
			V_SERVER_REGIONS,
			V_TRANSPORT,
			V_TRANSPORTABLES,
			islandVirtualId('abc'),
			regionBindingVirtualId('abc'),
			lazyEntryVirtualId('abc'),
			wrapperVirtualId('abc'),
			region_family('client_binding_stub')
		])
			expect(table.claims(id), id).toBe(true);
	});

	it('declares every virtual module the packages’ source imports', () => {
		const root = fileURLToPath(new URL('../../', import.meta.url));
		const files = fs
			.globSync('*/src/**/*.{ts,js,svelte}', { cwd: root })
			.filter((f) => !f.includes('/compiler/'));
		const ids = new Set<string>();
		for (const f of files) {
			const src = fs.readFileSync(path.join(root, f), 'latin1');
			for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](ogygia:[^'"]+)['"]/g))
				ids.add(m[1]);
		}
		expect(ids.has('ogygia:server') && ids.has('ogygia:boot')).toBe(true);
		for (const id of ids) expect(() => table.resolve(id), id).not.toThrow();
	});

	it('resolves an id it already resolved to itself (a barrel’s import, resolved again in SSR)', () => {
		// a package file re-exporting from ogygia:server: the bundler resolved its import, then asked
		// again with the resolved id, and the server bundle kept "\0ogygia:server" as an outside import
		expect(table.resolve(RESOLVED('ogygia:server'))).toBe(RESOLVED('ogygia:server'));
		expect(table.resolve(RESOLVED('ogygia:server/secret'))).toBe(RESOLVED('ogygia:server/secret'));
		expect(table.resolve(RESOLVED('some-plugin-id'))).toBeUndefined();
	});

	it('refuses a module of a realm the leg may not import, with virtual_wrong_realm', () => {
		const browser = { ssr: false, dev: false };
		const server = { ssr: true, dev: false };
		expect(() => table.resolve('ogygia:server', browser)).toThrow(/virtual_wrong_realm/);
		expect(() => table.resolve('ogygia:server/secret', browser)).toThrow(/virtual_wrong_realm/);
		expect(() => table.resolve('ogygia:boot', server)).toThrow(/virtual_wrong_realm/);
		expect(() => table.resolve('ogygia:dev/hmr', server)).toThrow(/virtual_wrong_realm/);
		expect(table.resolve('ogygia:dev/hmr', { ssr: false, dev: true })).toBeTruthy();
		expect(table.resolve('ogygia:region', browser)).toBe(RESOLVED('ogygia:region'));
		expect(table.resolve('ogygia:region', server)).toBe(RESOLVED('ogygia:region'));
	});

	it('refuses a browser-leg load of a server module, by its resolved id, with virtual_wrong_realm; the server leg still loads it', () => {
		const ctx = { build_secret: 'k'.repeat(64), id_salt: 'salt' } as Partial<CoreApp['ctx']>;
		for (const id of [
			'ogygia:server',
			'ogygia:server/secret',
			'ogygia:server/sign',
			'ogygia:server/server-plugins'
		])
			expect(() => table.load(RESOLVED(id), app(ctx), leg(false)), id).toThrow(
				/virtual_wrong_realm/
			);
		expect(table.load(RESOLVED('ogygia:server/secret'), app(ctx), leg(true))).toContain(
			'k'.repeat(64)
		);
		expect(table.load(RESOLVED('ogygia:region'), app(ctx), leg(false))).toBeTypeOf('string');
	});

	it('finds a module a leg’s output may not hold, however it got in', () => {
		const ids = [RESOLVED('ogygia:server/secret'), RESOLVED('ogygia:boot/runtime-flags'), '/a.js'];
		expect(table.misplaced(ids, { ssr: false, dev: false })).toEqual([
			[RESOLVED('ogygia:server/secret'), 'server']
		]);
		expect(table.misplaced(ids, { ssr: true, dev: false })).toEqual([
			[RESOLVED('ogygia:boot/runtime-flags'), 'boot']
		]);
	});

	it('words the table’s messages, and their pages', () => {
		for (const code of ['virtual_unknown', 'virtual_duplicate', 'virtual_names_stale'] as const) {
			expect(BUILD_ERRORS[code].text({ id: 'ogygia:server/x' })).toContain('ogygia:server/x');
			expect(BUILD_ERRORS[code].details().length).toBeGreaterThan(40);
		}
		expect(
			BUILD_ERRORS.virtual_wrong_realm.text({
				id: 'ogygia:server',
				realm: 'server',
				leg: 'browser'
			})
		).toContain('browser');
		expect(BUILD_ERRORS.virtual_wrong_realm.details().length).toBeGreaterThan(40);
	});

	it('fails an undeclared id in the namespace with virtual_unknown', () => {
		expect(() => table.resolve('ogygia:server/no-such-module')).toThrow(/virtual_unknown/);
		expect(() => table.resolve('ogygia:region/no-such-family/x.js')).toThrow(/virtual_unknown/);
	});

	it('leaves ids outside the namespace to the bundler', () => {
		expect(table.resolve('svelte')).toBeUndefined();
		expect(table.resolve('./a.ts')).toBeUndefined();
	});

	it('leaves the families the driver resolves to the driver, without calling them unknown', () => {
		expect(table.resolve(islandVirtualId('abc'))).toBeUndefined();
		expect(table.resolve('ogygia:region/fouc-css/x.js')).toBeUndefined();
		expect(table.resolve('ogygia:region/client-binding-stub')).toBeUndefined();
	});

	it('loads a family member by its prefix', () => {
		const id = table.resolve('ogygia:region/registry-stub/a.js?names=default,b')!;
		expect(id).toBe(RESOLVED('ogygia:region/registry-stub/a.js?names=default,b'));
		expect(table.load(id, app({}), leg(false))).toBe(
			`${dedent`
				export default undefined;
				export const b = undefined;
			`}\n`
		);
	});

	it('leaves a declared id with a query to the bundler, and fails an undeclared one', () => {
		expect(table.resolve('ogygia:server/secret?raw')).toBeUndefined();
		expect(() => table.resolve('ogygia:server/nope?raw')).toThrow(/virtual_unknown/);
	});

	it('takes a constant among its entries as a define, never a module it resolves', () => {
		const c = virtual.constant({ id: '__X__', from: () => true });
		const t = new VirtualTable([c, c], core_path, {}, CORE_PARTS, queries('t'));
		expect(t.claims('ogygia:server/__X__')).toBe(false);
	});

	it('refuses two declarations of one module with virtual_duplicate', () => {
		const a = virtual.value({ realm: 'server', id: 'x', from: () => ({}) });
		const names = { 'ogygia:server/x': [] };
		expect(() => new VirtualTable([a, a], core_path, names, CORE_PARTS, queries('t'))).toThrow(
			/virtual_duplicate/
		);
	});

	it('writes a value as module source (JSON, with each Set as a Set)', () => {
		expect(write_value({ a: 1, s: new Set(['x']), e: new Set(), l: ['u'] })).toBe(
			'{ "a": 1, "s": new Set(["x"]), "e": new Set(), "l": ["u"] }'
		);
	});

	it('reaches the server (and never the browser) with the region ttl', () => {
		const id = table.resolve('ogygia:server/region-ttl')!;
		const ctx = { region_ttl: 3600, renew_window: 2592000 };
		expect(table.load(id, app(ctx), leg(true))).toBe(
			'export const region_ttl = 3600;\nexport const renew_window = 2592000;'
		);
		expect(table.load(id, app(ctx), leg(false))).toBe(
			'export const region_ttl = 3600;\nexport const renew_window = 0;'
		);
	});

	it('writes a request module as a re-export of the built core module', () => {
		const id = table.resolve('ogygia:server/sign')!;
		const ctx = { runtime_dir: '/pkg/dist/runtime' };
		expect(table.load(id, app(ctx), leg(true))).toBe(
			'export { sign, region_sign } from "/pkg/dist/server/hmac.js";'
		);
	});

	it('serves each realm as one module of named re-exports, values first', () => {
		const id = table.resolve('ogygia:server')!;
		expect(id).toBe(RESOLVED('ogygia:server'));
		const src = table.load(id, app({}), leg(true)) as string;
		expect(src).toContain('export { region_ttl, renew_window } from "ogygia:server/region-ttl";');
		expect(src).toContain('region_css');
		expect(src).not.toContain('export default');
		// a request's real module may import the realm module back: every value is evaluated first
		const lines = src.split('\n');
		const last_value = lines.findLastIndex((l) => l.includes('region-ttl'));
		expect(lines.findIndex((l) => l.includes('ogygia:server/sign'))).toBeGreaterThan(last_value);
		expect(table.side_effect_free(id)).toBe(true);
		// a module that only runs is never in its realm module
		expect(table.load(table.resolve('ogygia:boot')!, app({}), leg(false))).not.toContain(
			'runtime-entry'
		);
	});

	it('imports a realm module’s names from the entries that have them', () => {
		const code = dedent`
			import { region_ttl, region_css as css, sign } from 'ogygia:server';
			export { kit_transport as transport } from "ogygia:region";
			import type { X } from 'ogygia:server';
			import * as all from 'ogygia:boot';
		`;
		expect(table.split_realm_imports(code)).toBe(
			dedent`
				import { region_ttl } from 'ogygia:server/region-ttl'; import { region_css as css } from 'ogygia:server/region-deps'; import { sign } from 'ogygia:server/sign';
				export { transport } from "ogygia:region/kit-transport";
				import type { X } from 'ogygia:server';
				import * as all from 'ogygia:boot';
			`
		);
		expect(table.split_realm_imports(`import { x } from './a.ts';`)).toBeNull();
		// a name the realm module does not have stays, for the bundler to refuse
		expect(table.split_realm_imports(`import { nope } from 'ogygia:server';`)).toBeNull();
	});

	it('refuses two entries that give their realm one name', () => {
		const a = virtual.value({ realm: 'server', id: 'a', from: () => ({ x: 1 }) });
		const b = virtual.value({ realm: 'server', id: 'b', from: () => ({ x: 2 }) });
		const names = { 'ogygia:server/a': ['x'], 'ogygia:server/b': ['x'] };
		expect(() => new VirtualTable([a, b], core_path, names, CORE_PARTS, queries('t'))).toThrow(
			/virtual_duplicate/
		);
	});

	it('stubs every realm export for the unit tests (test/_stubs/realm-<realm>.ts)', () => {
		for (const realm of ['server', 'boot', 'region'] as const) {
			const src = table.load(table.resolve(`ogygia:${realm}`)!, app({}), leg(true)) as string;
			const names = [...src.matchAll(/(?:\{ |, )(?:\w+ as )?(\w+)/g)].map((m) => m[1]);
			const stub = fs.readFileSync(
				new URL(`../../core/test/_stubs/realm-${realm}.ts`, import.meta.url),
				'utf8'
			);
			for (const name of names)
				expect(stub, `${realm}: ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
		}
	});

	it('reloads core’s route modules on a route change, and its plugin list on a plugin change', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-reads-'));
		fs.mkdirSync(path.join(root, 'src/routes'), { recursive: true });
		const core_app = {
			ctx: { root, is_dev: true, routes: route_reader(node_fs) },
			routes_dir: () => path.join(root, 'src/routes'),
			plugins: () => ({ server: [], client: [], route_config: [] })
		} as unknown as CoreApp;
		const fresh = () => {
			const t = new VirtualTable<CoreApp>(
				CORE_VIRTUALS,
				core_path,
				CORE_VALUE_NAMES,
				CORE_PARTS,
				queries('session')
			);
			for (const id of ['route-csr', 'route-config', 'server-plugins', 'rate-limit'])
				t.load(RESOLVED(`ogygia:server/${id}`), core_app, leg(true));
			return t;
		};
		const moved_by = (part: Part): string[] => {
			const t = fresh();
			t.move(part);
			return t.moved().sort();
		};
		expect(moved_by('routes')).toEqual([
			RESOLVED('ogygia:server/route-config'),
			RESOLVED('ogygia:server/route-csr')
		]);
		expect(moved_by('plugins')).toEqual([
			RESOLVED('ogygia:server/route-config'),
			RESOLVED('ogygia:server/server-plugins')
		]);
		expect(moved_by('regions')).toEqual([]);
		fs.rmSync(root, { recursive: true, force: true });
	});
});
