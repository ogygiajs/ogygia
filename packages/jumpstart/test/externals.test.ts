import { describe, expect, it } from 'vitest';
import { Externals, package_of } from '../src/externals.ts';

describe('the external report', () => {
	it('names the package of a bare specifier', () => {
		expect(package_of('sharp')).toBe('sharp');
		expect(package_of('date-fns/format')).toBe('date-fns');
		expect(package_of('@acme/db')).toBe('@acme/db');
		expect(package_of('@acme/db/pool')).toBe('@acme/db');
	});

	it("counts packages only: relative paths, absolute paths and Node's own modules are not", () => {
		const e = new Externals([], []);
		for (const spec of [
			'./chunks/x.js',
			'../y.js',
			'/abs/z.js',
			'node:fs',
			'fs',
			'path',
			'\0virtual'
		])
			e.add(spec);
		expect([...e.found.keys()]).toEqual([]);
	});

	it('says why each package stayed out: the option first, then the Vite config, else Vite', () => {
		const e = new Externals(['sharp'], ['sharp', 'pg']);
		e.add('sharp');
		e.add('pg/native');
		e.add('fsevents');
		e.add('pg');
		expect(Object.fromEntries(e.found)).toEqual({
			sharp: 'jumpstart',
			pg: 'config',
			fsevents: 'vite'
		});
	});

	it('prints one coded line with every package and its reason, sorted', () => {
		const e = new Externals(['sharp'], []);
		e.add('zlib-sync');
		e.add('sharp');
		const report = e.report();
		expect(report).toContain(
			'jumpstart: 2 outside the server bundle: sharp (jumpstart({ external })), zlib-sync (kept out by Vite or another plugin)'
		);
		expect(report).toContain('https://ogygiajs.dev/e/jumpstart_external');
	});

	it('says so when every dependency is inside the bundle (never silent)', () => {
		const report = new Externals([], []).report();
		expect(report).toContain('every dependency is inside the server bundle');
		expect(report).toContain('https://ogygiajs.dev/e/jumpstart_external_none');
	});
});
