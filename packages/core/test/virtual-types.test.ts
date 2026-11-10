/**
 * The virtual modules' declarations are generated from the table, and checked against what the
 * modules export: a value's keys and a request's functions are the names its types declare.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { CORE_VIRTUALS, type CoreApp } from '../src/compiler/virtual/core.ts';
import { virtual_types, REALMS } from '../src/compiler/virtual/types.ts';

const declared_names = (types: string | undefined): string[] =>
	[
		...(types ?? '').matchAll(
			/^export (?:const|function|default) ?([A-Za-z_$][\w$]*)?|^export default/gm
		)
	]
		.map((m) => (m[0].startsWith('export default') ? 'default' : m[1]))
		.sort();

/** A compile session good enough for a value entry's `from` on the server leg. */
const app = {
	ctx: new Proxy(
		{ is_dev: true, client_plugins: [], rate_limit: { max: 0, windowMs: 1 } },
		{ get: (t, k) => (k in t ? t[k as keyof typeof t] : '') }
	),
	prescan() {},
	region_names: () => ({}),
	runtime_chunk_url: () => ''
} as unknown as CoreApp;

describe('the virtual modules’ declarations', () => {
	it('are the ones the table generates (run scripts/virtual-types.ts after changing an entry)', () => {
		const want = virtual_types(CORE_VIRTUALS);
		for (const realm of REALMS) {
			const file = new URL(`../virtual/${realm}.d.ts`, import.meta.url);
			expect(fs.readFileSync(file, 'utf8'), `virtual/${realm}.d.ts`).toBe(want[realm]);
		}
	});

	it('declare exactly the names a value module writes', () => {
		for (const e of CORE_VIRTUALS) {
			if (e.kind !== 'value') continue;
			// (route-csr's server leg reads the app's routes from disk; its browser leg has the same keys)
			const ssr = e.id !== 'route-csr';
			const keys = Object.keys(e.from(app, { ssr, universalHooks: null })).sort();
			expect(declared_names(e.types), e.id).toEqual(keys);
		}
	});

	it('declare exactly the functions a request module re-exports', () => {
		for (const e of CORE_VIRTUALS) {
			if (e.kind !== 'request') continue;
			expect(declared_names(e.types), e.id).toEqual([...e.exports].sort());
		}
	});
});
