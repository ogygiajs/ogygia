// The runtime features a build ships follow what its files registered: a plain app pays for no wire
// decoder, no remote seeding and no live/morph runtime; a region turns on exactly what it needs.
import { describe, expect, it } from 'vitest';
import { Program, type IslandDescriptor } from '../src/compiler/program.ts';

const HOST = '/app/src/routes/+page.svelte';
const marks = (islands: IslandDescriptor[], extra: { hasWireCrossing?: boolean } = {}) => {
	const program = new Program({ forms: false, router: false });
	program.register({ islands, ...extra }, HOST);
	return program.runtime_marks;
};

describe('a fresh program ships only what its options ask for', () => {
	it('no wire decoder, no remote seeding, no live runtime', () => {
		const m = new Program({ forms: false, router: false }).runtime_marks;
		expect(m).toMatchObject({ wire: false, remoteSeeds: false, live: false, lakes: false });
	});

	it('the router ships whenever the option is on, with no `<Router/>` seen', () => {
		expect(new Program({ forms: false, router: true }).runtime_marks.router).toBe(true);
		expect(new Program({ forms: false, router: false }).runtime_marks.router).toBe(false);
	});
});

describe('a registration turns on what its regions need', () => {
	it('a file that crosses live content into a region ships the wire decoder', () => {
		expect(marks([], { hasWireCrossing: true }).wire).toBe(true);
		expect(marks([]).wire).toBe(false);
	});

	it('a defer region marks its fetch timing; a hydrate region its wake strategy', () => {
		const m = marks([
			{ id: 'a', kind: 'defer', fetchWhen: 'visible' },
			{ id: 'b', kind: 'hydrate', strategy: 'idle' },
			{ id: 'c', kind: 'hydrate', wakeAfter: 'interaction' }
		]);
		expect(m.defer).toEqual(['visible']);
		expect(m.hydrate).toEqual(['idle', 'load', 'interaction']);
	});

	it('a held region ships live and client morph; a plain wake binding does not', () => {
		expect(
			marks([{ id: 'a', kind: 'hydrate', bindingPath: 'x.js', bindingSsrSource: '' }])
		).toMatchObject({ live: false });
		expect(marks([{ id: 'a', kind: 'hydrate', bindingPath: 'x.js', held: true }])).toMatchObject({
			live: true,
			morph: true
		});
	});

	it('a lake ships the lake runtime and a never-waking schedule', () => {
		const m = marks([{ id: 'a', kind: 'lake' }]);
		expect(m.lakes).toBe(true);
		expect(m.hydrate).toEqual(['none']);
	});
});
