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
import { CORE_VIRTUALS, type CoreApp } from '../src/compiler/virtual/core.ts';
import { virtual, write_exports, type Leg } from '../src/compiler/virtual/table.ts';
import { RESOLVED } from '../src/compiler/ids.ts';
import { BUILD_ERRORS } from '../src/messages/build.ts';

const table = new VirtualTable<CoreApp>(CORE_VIRTUALS);
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
		expect(ids.size).toBeGreaterThan(10);
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
		const a = virtual.value({ realm: 'server', id: 'x', from: () => ({}) });
		expect(() => new VirtualTable([a, a])).toThrow(/virtual_duplicate/);
	});

	it('writes a value module from its data (a Set, and the default export)', () => {
		expect(write_exports({ a: 1, s: new Set(['x']), default: 'u' })).toBe(
			'export const a = 1;\nexport const s = new Set(["x"]);\nexport default "u";'
		);
	});

	it('reaches the server (and never the browser) with the region ttl', () => {
		const id = table.resolve('virtual:ogygia/region-ttl')!;
		const ctx = { region_ttl: 3600, renew_window: 2592000 };
		expect(table.load(id, app(ctx), leg(true))).toContain('export const renewWindow = 2592000;');
		expect(table.load(id, app(ctx), leg(false))).toContain('export const renewWindow = 0;');
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
