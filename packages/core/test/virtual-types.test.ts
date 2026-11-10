/**
 * The virtual modules' declarations are generated from the table and point TypeScript at the code
 * (a value's `from`, a request's real module, a family's contract interface): the files on disk are
 * the ones the table generates, and every value, request and family entry is declared by reference.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as core from '../src/compiler/virtual/core.ts';
import {
	virtual_types,
	constant_types,
	probe_value_names,
	value_names_source,
	REALMS,
	CORE_ENTRIES_PATH
} from '../src/compiler/virtual/types.ts';
import { CORE_VALUE_NAMES } from '../src/compiler/virtual/value-names.ts';
import { VirtualTable } from '../src/compiler/virtual/resolver.ts';
import { virtual } from '../src/compiler/virtual/table.ts';

const names = probe_value_names(core.CORE_VIRTUALS, core.CORE_PROBE.app, core.CORE_PROBE.leg);
const want = virtual_types(core, CORE_ENTRIES_PATH, names);
const squash = (s: string): string => s.replace(/[\s'"]+/g, '');

describe('the virtual modules’ declarations', () => {
	it('name each value entry’s exports as a fresh probe of its `from` does', () => {
		expect(CORE_VALUE_NAMES).toEqual(names);
		const file = new URL('../src/compiler/virtual/value-names.ts', import.meta.url);
		// (the committed file is formatted; the names, quotes aside, are the generated ones)
		expect(squash(fs.readFileSync(file, 'utf8'))).toBe(squash(value_names_source(names)));
	});

	it('refuse a value module whose names were not generated, or whose live names moved', () => {
		const e = virtual.value({ realm: 'server', id: 'v', from: () => ({ a: 1, b: 2 }) });
		const stale = new VirtualTable<null>([e], () => '', { 'ogygia:server/v': ['a'] }, {});
		const leg = { ssr: true, universalHooks: null };
		expect(() => stale.load('\0ogygia:server/v', null, leg)).toThrow(/virtual_names_stale/);
		expect(() => new VirtualTable<null>([e], () => '', {}, {})).toThrow(/virtual_names_stale/);
	});

	it('are the ones the table generates (run scripts/virtual-types.ts after changing an entry)', () => {
		for (const realm of REALMS) {
			const file = new URL(`../virtual/${realm}.d.ts`, import.meta.url);
			expect(fs.readFileSync(file, 'utf8'), `virtual/${realm}.d.ts`).toBe(want[realm]);
		}
		const constants = new URL('../virtual/constants.d.ts', import.meta.url);
		expect(fs.readFileSync(constants, 'utf8'), 'virtual/constants.d.ts').toBe(
			constant_types(core, CORE_ENTRIES_PATH)
		);
	});

	it('declare each switch from its constant, and the switches are the build’s defines', () => {
		const text = constant_types(core, CORE_ENTRIES_PATH);
		expect(text).toContain(
			`declare const __OGYGIA_DEVTOOLS__: import('../dist/compiler/virtual/table.js').ConstOf<typeof import('../dist/compiler/virtual/core.js').devtools_gate>;`
		);
		const defines = core.core_defines({
			continuity_forms: true,
			server_delta: false,
			devtools: true,
			devtools_lazy: false,
			rules: false,
			client_plugins: false,
			hooks: ['regionHydrated'],
			kit_major: 2,
			version: '1.2.3',
			dev_server: false
		});
		expect(Object.keys(defines).length).toBe(core.CORE_CONSTANTS.length);
		expect(defines.__OGYGIA_DEVTOOLS__).toBe('true');
		expect(defines.__OGYGIA_HOOK_REGION_HYDRATED__).toBe('true');
		expect(defines.__OGYGIA_HOOK_NAVIGATED__).toBe('false');
		expect(defines.__OGYGIA_VERSION__).toBe('"1.2.3"');
		expect(defines.__OGYGIA_DEV_HMR_URL__).toBe('""');
	});

	it('type each realm export from its code, never by hand', () => {
		const realm = want.server.split(`declare module 'ogygia:server' {`)[1].split('\n}')[0];
		expect(realm).toContain(
			`export const region_ttl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['region_ttl'];`
		);
		expect(realm).toContain(
			`export { sign, verify, region_mac_message } from '../dist/server/hmac.js';`
		);
		expect(realm).toContain(
			`export const region_css: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['region_css'];`
		);
	});

	it('declare each entry by its realm-named id only', () => {
		const all = Object.values(want).join('\n');
		expect(all).toContain(`declare module 'ogygia:server/secret' {`);
		expect(all).not.toContain('virtual:ogygia');
	});
});
