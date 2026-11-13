// The island sourcemap pass: a generated wrapper has no source anywhere, so its map is dropped (Vite
// skips injecting sources for empty mappings and warns about none); an island entry's map points at
// the full virtual id and carries the generated source, so devtools show it and Vite reads no disk.
import { describe, expect, it } from 'vitest';
import { island_sourcemaps_plugin } from '../src/vite/sourcemaps.ts';
import { Program } from '../src/compiler/program.ts';

const ENTRY = 'ogygia:region/entry/abc.svelte';
const WRAPPER = 'ogygia:region/wrapper/abc.svelte';

const run = (id: string, map: unknown) => {
	const program = new Program({ forms: false, router: false });
	program.registry.set(ENTRY, { id: 'abc', source: '<p>generated</p>' });
	const plugin = island_sourcemaps_plugin({
		program: () => program,
		is_island_path: (p) => p.startsWith('ogygia:region/')
	});
	const ctx = {
		getCombinedSourcemap: typeof map === 'function' ? map : () => map
	};
	return (plugin.transform as (this: unknown, code: string, id: string) => unknown).call(
		ctx,
		'code',
		id
	);
};

describe('island_sourcemaps_plugin', () => {
	it('leaves a module that is not an island alone', () => {
		expect(run('/app/src/A.svelte', { mappings: 'AAAA', sources: ['A.svelte'] })).toBeNull();
	});

	it("drops a wrapper's map", () => {
		expect(run(`${WRAPPER}?x`, { mappings: 'AAAA', sources: ['abc.svelte'] })).toEqual({
			code: 'code',
			map: { mappings: '' }
		});
	});

	it("points an entry's map at its virtual id and carries the generated source", () => {
		expect(
			run(ENTRY, { version: 3, mappings: 'AAAA', names: [], sources: ['abc.svelte'] })
		).toEqual({
			code: 'code',
			map: {
				version: 3,
				mappings: 'AAAA',
				names: [],
				sources: [ENTRY],
				sourcesContent: ['<p>generated</p>']
			}
		});
	});

	it('keeps sources content a map already has', () => {
		const out = run(ENTRY, {
			mappings: 'AAAA',
			sources: ['abc.svelte'],
			sourcesContent: ['own']
		}) as { map: { sourcesContent: string[] } };
		expect(out.map.sourcesContent).toEqual(['own']);
	});

	it('an entry with no combined map, or an empty one, keeps what it has', () => {
		expect(
			run(ENTRY, () => {
				throw new Error('no map');
			})
		).toBeNull();
		expect(run(ENTRY, { mappings: '', sources: ['abc.svelte'] })).toBeNull();
	});
});
