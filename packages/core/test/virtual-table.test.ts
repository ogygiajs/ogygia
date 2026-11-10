/**
 * The virtual-module table (src/compiler/virtual/): every module ogygia serves is declared once, an
 * undeclared id in the namespace fails with a code, a realm-named specifier and its legacy alias
 * are one module, and a dev change invalidates exactly the entries that watch it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VirtualTable } from '../src/compiler/virtual/resolver.ts';
import { CORE_VIRTUALS, core_path, type CoreApp } from '../src/compiler/virtual/core.ts';
import { virtual, write_value, type Leg } from '../src/compiler/virtual/table.ts';
import { RESOLVED } from '../src/compiler/ids.ts';
import { BUILD_ERRORS } from '../src/messages/build.ts';

const table = new VirtualTable<CoreApp>(CORE_VIRTUALS, core_path);
const app = (ctx: Partial<CoreApp['ctx']>): CoreApp => ({ ctx }) as unknown as CoreApp;
const leg = (ssr: boolean): Leg => ({ ssr, universalHooks: null });

describe('the virtual-module table', () => {
	it('resolves a realm-named specifier and its legacy alias to the same module', () => {
		expect(table.resolve('ogygia:server/secret')).toBe(RESOLVED('virtual:ogygia/secret'));
		expect(table.resolve('virtual:ogygia/secret')).toBe(RESOLVED('virtual:ogygia/secret'));
	});

	it('declares every virtual module the packages’ source imports', () => {
		const root = fileURLToPath(new URL('../../', import.meta.url));
		const files = fs
			.globSync('*/src/**/*.{ts,js,svelte}', { cwd: root })
			.filter((f) => !f.includes('/compiler/'));
		const ids = new Set<string>();
		for (const f of files) {
			const src = fs.readFileSync(path.join(root, f), 'latin1');
			for (const m of src.matchAll(
				/(?:from|import)\s*\(?\s*['"]((?:virtual:ogygia|ogygia:)[^'"]+)['"]/g
			))
				ids.add(m[1]);
		}
		expect(ids.has('ogygia:server') && ids.has('ogygia:boot')).toBe(true);
		for (const id of ids) expect(() => table.resolve(id), id).not.toThrow();
	});

	it('words the table’s messages, and their pages', () => {
		for (const code of ['virtual_unknown', 'virtual_duplicate'] as const) {
			expect(BUILD_ERRORS[code].text({ id: 'ogygia:server/x' })).toContain('ogygia:server/x');
			expect(BUILD_ERRORS[code].details().length).toBeGreaterThan(40);
		}
	});

	it('fails an undeclared id in the namespace with virtual_unknown', () => {
		expect(() => table.resolve('virtual:ogygia/no-such-module')).toThrow(/virtual_unknown/);
		expect(() => table.resolve('ogygia:server/no-such-module')).toThrow(/virtual_unknown/);
	});

	it('leaves ids outside the namespace to the bundler', () => {
		expect(table.resolve('svelte')).toBeUndefined();
		expect(table.resolve('./a.ts')).toBeUndefined();
	});

	it('leaves the families the driver resolves to the driver, without calling them unknown', () => {
		expect(table.resolve('virtual:ogygia/island/abc.js')).toBeUndefined();
		expect(table.resolve('virtual:ogygia/fouc-css/x.js')).toBeUndefined();
		expect(table.resolve('virtual:ogygia/client-binding-stub')).toBeUndefined();
	});

	it('loads a family member by its prefix', () => {
		const id = table.resolve('virtual:ogygia/registry-stub/a.js?names=default,b')!;
		expect(id).toBe(RESOLVED('virtual:ogygia/registry-stub/a.js?names=default,b'));
		expect(table.load(id, app({}), leg(false))).toBe(
			'export default undefined;\nexport const b = undefined;\n'
		);
	});

	it('refuses two declarations of one module with virtual_duplicate', () => {
		const a = virtual.value({ realm: 'server', id: 'x', exports: [], from: () => ({}) });
		expect(() => new VirtualTable([a, a], core_path)).toThrow(/virtual_duplicate/);
	});

	it('writes a value as module source (JSON, with each Set as a Set)', () => {
		expect(write_value({ a: 1, s: new Set(['x']), e: new Set(), l: ['u'] })).toBe(
			'{ "a": 1, "s": new Set(["x"]), "e": new Set(), "l": ["u"] }'
		);
	});

	it('reaches the server (and never the browser) with the region ttl', () => {
		const id = table.resolve('virtual:ogygia/region-ttl')!;
		const ctx = { region_ttl: 3600, renew_window: 2592000 };
		expect(table.load(id, app(ctx), leg(true))).toBe(
			'export const region_ttl = 3600;\nexport const renew_window = 2592000;'
		);
		expect(table.load(id, app(ctx), leg(false))).toBe(
			'export const region_ttl = 3600;\nexport const renew_window = 0;'
		);
	});

	it('writes a request module as a re-export of the built core module', () => {
		const id = table.resolve('virtual:ogygia/sign')!;
		const ctx = { runtime_dir: '/pkg/dist/runtime' };
		expect(table.load(id, app(ctx), leg(true))).toBe(
			'export { sign, verify, region_mac_message } from "/pkg/dist/server/hmac.js";'
		);
	});

	it('serves each realm as one module of named re-exports, values first', () => {
		const id = table.resolve('ogygia:server')!;
		expect(id).toBe(RESOLVED('ogygia:server'));
		const src = table.load(id, app({}), leg(true)) as string;
		expect(src).toContain('export { region_ttl, renew_window } from "virtual:ogygia/region-ttl";');
		expect(src).toContain('islandCss as region_css');
		expect(src).not.toContain('export default');
		// a request's real module may import the realm module back: every value is evaluated first
		const lines = src.split('\n');
		const last_value = lines.findLastIndex((l) => l.includes('region-ttl'));
		expect(lines.findIndex((l) => l.includes('virtual:ogygia/sign'))).toBeGreaterThan(last_value);
		expect(table.side_effect_free(id)).toBe(true);
		// a module that only runs is never in its realm module
		expect(table.load(table.resolve('ogygia:boot')!, app({}), leg(false))).not.toContain(
			'runtime-entry'
		);
	});

	it('imports a realm module’s names from the entries that have them', () => {
		const code = [
			`import { region_ttl, region_css as css, sign } from 'ogygia:server';`,
			`export { kit_transport as transport } from "ogygia:region";`,
			`import type { X } from 'ogygia:server';`,
			`import * as all from 'ogygia:boot';`
		].join('\n');
		expect(table.split_realm_imports(code)).toBe(
			[
				`import { region_ttl } from 'virtual:ogygia/region-ttl'; import { islandCss as css } from 'virtual:ogygia/island-deps'; import { sign } from 'virtual:ogygia/sign';`,
				`export { transport } from "virtual:ogygia/kit-transport";`,
				`import type { X } from 'ogygia:server';`,
				`import * as all from 'ogygia:boot';`
			].join('\n')
		);
		expect(table.split_realm_imports(`import { x } from './a.ts';`)).toBeNull();
		// a name the realm module does not have stays, for the bundler to refuse
		expect(table.split_realm_imports(`import { nope } from 'ogygia:server';`)).toBeNull();
	});

	it('refuses two entries that give their realm one name', () => {
		const a = virtual.value({ realm: 'server', id: 'a', exports: ['x'], from: () => ({ x: 1 }) });
		const b = virtual.value({ realm: 'server', id: 'b', exports: ['x'], from: () => ({ x: 2 }) });
		expect(() => new VirtualTable([a, b], core_path)).toThrow(/virtual_duplicate/);
	});

	it('stubs every realm export for the unit tests (test/_stubs/realm-<realm>.ts)', () => {
		for (const realm of ['server', 'boot', 'region'] as const) {
			const src = table.load(table.resolve(`ogygia:${realm}`)!, app({}), leg(true)) as string;
			const names = [...src.matchAll(/(?:\{ |, )(?:\w+ as )?(\w+)/g)].map((m) => m[1]);
			const stub = fs.readFileSync(new URL(`./_stubs/realm-${realm}.ts`, import.meta.url), 'utf8');
			for (const name of names)
				expect(stub, `${realm}: ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
		}
	});

	it('invalidates exactly the modules that watch a change', () => {
		expect(table.watching('regions').sort()).toEqual([
			RESOLVED('virtual:ogygia/server-islands'),
			RESOLVED('virtual:ogygia/server-manifest')
		]);
		expect(table.watching('routes').sort()).toEqual([
			RESOLVED('virtual:ogygia/route-config'),
			RESOLVED('virtual:ogygia/route-csr')
		]);
		expect(table.watching('styles')).toEqual([RESOLVED('virtual:ogygia/router-css')]);
	});
});
