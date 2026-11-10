/**
 * The virtual modules' declarations are generated from the table and point TypeScript at the code
 * (a value's `from`, a request's real module, a family's contract interface): the files on disk are
 * the ones the table generates, and every value, request and family entry is declared by reference.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as core from '../src/compiler/virtual/core.ts';
import { virtual_types, REALMS, CORE_ENTRIES_PATH } from '../src/compiler/virtual/types.ts';

const want = virtual_types(core, CORE_ENTRIES_PATH);

describe('the virtual modules’ declarations', () => {
	it('are the ones the table generates (run scripts/virtual-types.ts after changing an entry)', () => {
		for (const realm of REALMS) {
			const file = new URL(`../virtual/${realm}.d.ts`, import.meta.url);
			expect(fs.readFileSync(file, 'utf8'), `virtual/${realm}.d.ts`).toBe(want[realm]);
		}
	});

	it('type each module from its code, never by hand', () => {
		const all = Object.values(want).join('\n');
		expect(all).toContain(
			`const value: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>;`
		);
		expect(all).toContain(
			`export { sign, verify, region_mac_message } from '../dist/server/hmac.js';`
		);
		expect(all).toContain(
			`const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>;`
		);
	});

	it('declare an alias from its entry, the same way as its realm name', () => {
		const server = want.server;
		const realm = server.split(`declare module 'ogygia:server/secret' {`)[1].split('}')[0];
		const alias = server.split(`declare module 'virtual:ogygia/secret' {`)[1].split('}')[0];
		expect(alias).toBe(realm);
	});
});
