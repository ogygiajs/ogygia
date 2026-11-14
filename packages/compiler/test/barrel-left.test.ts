// The table of why a barrel stayed (src/exports/left.ts): what a stage transform said about
// each module's imports, read back for the barrels an island still imports whole.
import { describe, expect, it } from 'vitest';
import { BarrelLeftTable } from '../src/exports/left.ts';

describe('the barrel-left table', () => {
	it('answers the reasons recorded for a barrel, in a fixed order, once each', () => {
		const t = new BarrelLeftTable();
		t.record('/app/src/B.svelte', '/app/lib/index.ts', 'namespace');
		t.record('/app/src/A.svelte', '/app/lib/index.ts', 'impure');
		t.record('/app/src/C.ts', '/app/lib/index.ts', 'impure');
		expect(t.why('/app/lib/index.ts', [])).toEqual(['impure', 'namespace']);
		expect(t.why('/app/lib/other.ts', [])).toEqual([]);
	});

	it('a component that could not be parsed explains every barrel it imports, joined by importer', () => {
		const t = new BarrelLeftTable();
		t.record('/app/src/Broken.svelte', null, 'unparsable');
		expect(t.why('/app/lib/index.ts', ['/app/src/Broken.svelte?v=1'])).toEqual(['unparsable']);
		expect(t.why('/app/lib/index.ts', ['/app/src/Fine.svelte'])).toEqual([]);
	});

	it("a dependency's barrel is not explained by an unparsable importer (the pass never rewrites into it unasked)", () => {
		const t = new BarrelLeftTable();
		t.record('/app/src/Broken.svelte', null, 'unparsable');
		expect(
			t.why('/app/node_modules/svelte/src/index-client.js', ['/app/src/Broken.svelte'])
		).toEqual([]);
	});

	it('a module transformed again forgets what it said before', () => {
		const t = new BarrelLeftTable();
		t.record('/app/src/A.svelte', '/app/lib/index.ts', 'pinned');
		t.record('/app/src/Broken.svelte', null, 'unparsable');
		t.forget('/app/src/A.svelte');
		t.forget('/app/src/Broken.svelte');
		expect(t.why('/app/lib/index.ts', ['/app/src/Broken.svelte'])).toEqual([]);
		expect(t.size).toBe(0);
	});

	it('holds at most its cap of barrels: a new barrel past it is not recorded, a known one still is', () => {
		const t = new BarrelLeftTable(3);
		for (let i = 0; i < 10; i++) t.record(`/app/src/I${i}.ts`, `/app/lib/b${i}.ts`, 'impure');
		expect(t.size).toBe(3);
		expect(t.why('/app/lib/b9.ts', [])).toEqual([]);
		t.record('/app/src/J.ts', '/app/lib/b0.ts', 'namespace');
		expect(t.why('/app/lib/b0.ts', [])).toEqual(['impure', 'namespace']);
	});

	it('clear empties it (the end of a build leg, the dev server closing)', () => {
		const t = new BarrelLeftTable();
		t.record('/app/src/A.ts', '/app/lib/index.ts', 'kept');
		t.clear();
		expect(t.size).toBe(0);
		expect(t.why('/app/lib/index.ts', [])).toEqual([]);
	});
});
