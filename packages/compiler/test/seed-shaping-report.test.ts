import { describe, expect, it, vi } from 'vitest';
import { report_seed_shaping } from '../src/compiler/link/build-output.ts';

// The build's seed report names, per island that ships all of page.data, the modules to blame —
// the handoff carries them so the profiler can point at that line.

describe('report_seed_shaping', () => {
	it("returns each unpinned island's blamed modules, root-relative, from its own closure only", () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const why = report_seed_shaping(
			{
				page: { 'a.js': true, 'b.js': true, 'c.js': true },
				page_keys: { 'a.js': null, 'b.js': ['_locale'], 'c.js': null }
			},
			{
				'a.js': { type: 'chunk', moduleIds: ['/app/src/lib/A.svelte'], imports: ['shared.js'] },
				'shared.js': { type: 'chunk', moduleIds: ['/app/src/lib/helper.ts'] },
				'b.js': { type: 'chunk', moduleIds: ['/app/src/lib/B.svelte'] },
				'c.js': { type: 'chunk', moduleIds: ['/app/src/lib/C.svelte'] }
			},
			{
				page_key_reasons: new Map([
					['/app/src/lib/helper.ts', { why: '`page.data` is spread', line: 7 }],
					['/app/src/lib/C.svelte', { why: '`page.data` is passed on', line: 3 }]
				])
			},
			'/app'
		);
		log.mockRestore();
		expect(why).toEqual({
			'a.js': [{ file: 'src/lib/helper.ts', line: 7, why: '`page.data` is spread' }],
			'c.js': [{ file: 'src/lib/C.svelte', line: 3, why: '`page.data` is passed on' }]
		});
	});

	it("an island keyed by its identity is blamed through its emitted file's closure", () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const why = report_seed_shaping(
			{ page: { '/og-region.a.js': true }, page_keys: { '/og-region.a.js': null } },
			{
				'og-region.a-1f2e.js': {
					type: 'chunk',
					moduleIds: ['/app/src/lib/A.svelte'],
					imports: ['shared.js']
				},
				'shared.js': { type: 'chunk', moduleIds: ['/app/src/lib/helper.ts'] }
			},
			{ page_key_reasons: new Map([['/app/src/lib/helper.ts', { why: 'spread', line: 7 }]]) },
			'/app',
			(identity) => (identity === '/og-region.a.js' ? '/og-region.a-1f2e.js' : identity)
		);
		log.mockRestore();
		expect(why).toEqual({
			'/og-region.a.js': [{ file: 'src/lib/helper.ts', line: 7, why: 'spread' }]
		});
	});
});
