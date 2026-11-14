// The restorer is inlined into every page that restores something, so its size is every such page's
// cost. The build minifies its module (tsdown.config.ts); this holds the budget, measured the way the
// build does it, and the per-chunk call's length.
import { brotliCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { minifySync } from 'rolldown/utils';
import { isScriptUrl } from '@ogygia/core/plugin/utils';
import { restore_adopt, restore_with } from '../src/restore.ts';
import { RESTORE_CALL } from '../src/pass.ts';

describe('the inlined restorer', () => {
	it('minified as the build does, stays inside its budget: 9.7 kB, 3.45 kB brotli', () => {
		const source = [isScriptUrl, restore_with, restore_adopt]
			.map((f) => `export ${f.toString()}`)
			.join('\n');
		const min = minifySync('restore.js', source, { compress: true, mangle: true }).code;
		const brotli = brotliCompressSync(Buffer.from(min)).length;
		expect(min.length).toBeLessThan(9700);
		expect(brotli).toBeLessThan(3450);
		expect(min).not.toMatch(/\/\*|^\s*\/\//m);
	});

	it('a later chunk’s restore is one short call', () => {
		expect(RESTORE_CALL.length).toBeLessThan(60);
	});
});
