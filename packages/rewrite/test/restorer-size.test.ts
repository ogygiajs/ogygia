// The restorer is inlined into every page that restores something, so its size is every such page's
// cost. The build minifies its module (tsdown.config.ts); this holds the budget, measured the way the
// build does it, and the per-chunk call's length.
import { brotliCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { minifySync } from 'rolldown/utils';
import { restore, restore_adopt } from '../src/restore.ts';
import { RESTORE_CALL } from '../src/pass.ts';

describe('the inlined restorer', () => {
	it('minified as the build does, stays inside its budget: 9 kB, 3.2 kB brotli', () => {
		const source = `export ${restore.toString()}\nexport ${restore_adopt.toString()}`;
		const min = minifySync('restore.js', source, { compress: true, mangle: true }).code;
		const brotli = brotliCompressSync(Buffer.from(min)).length;
		expect(min.length).toBeLessThan(9000);
		expect(brotli).toBeLessThan(3200);
		expect(min).not.toMatch(/\/\*|^\s*\/\//m);
	});

	it('a later chunk’s restore is one short call', () => {
		expect(RESTORE_CALL.length).toBeLessThan(60);
	});
});
