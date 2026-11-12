// slot() (src/slot.ts): one process-global value per name, shared by every copy of a package a
// process loads (dev serves the runtime twice), and a copy at another shape version is caught
// instead of reading a value of the wrong shape.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slot } from '../src/index.ts';

let n = 0;
/** A name no other test used. */
const fresh = (): `ogygia.${string}` => `ogygia.test.slot.${n++}`;

afterEach(() => vi.restoreAllMocks());

describe('slot', () => {
	it('makes the value once, and every later call (another copy) gets the same one', () => {
		const name = fresh();
		const a = slot({ name, version: 1, make: () => ({ n: 1 }) });
		const b = slot({ name, version: 1, make: () => ({ n: 2 }) });
		expect(b).toBe(a);
		expect(a.n).toBe(1);
	});

	it('a copy at another version is refused in dev: both versions named', () => {
		const name = fresh();
		slot({ name, version: 1, make: () => ({}) });
		expect(() => slot({ name, version: 2, make: () => ({}) })).toThrow(/machine_slot_version/);
		expect(() => slot({ name, version: 2, make: () => ({}) })).toThrow(/1.*2|2.*1/);
	});

	it('a name outside ogygia., one with a version suffix, or a bad version is refused', () => {
		const make = () => ({});
		expect(() => slot({ name: 'other.thing' as `ogygia.${string}`, version: 1, make })).toThrow(
			/machine_bad_option/
		);
		expect(() => slot({ name: `${fresh()}.v2`, version: 2, make })).toThrow(/version/);
		expect(() => slot({ name: fresh(), version: 1.5, make })).toThrow(/version/);
	});
});
