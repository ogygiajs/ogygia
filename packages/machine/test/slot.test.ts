// slot() (src/slot.ts): one process-global value per name, shared by every copy of a package a
// process loads (dev serves the runtime twice), and a copy at another shape version is caught
// instead of reading a value of the wrong shape.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slot } from '../src/index.ts';

const g = globalThis as unknown as Record<symbol, unknown>;
let n = 0;
/** A name no other test used. */
const fresh = () => `ogygia.test.slot.${n++}`;

afterEach(() => vi.restoreAllMocks());

describe('slot', () => {
	it('makes the value once, and every later call (another copy) gets the same one', () => {
		const name = fresh();
		const a = slot(name, 1, () => ({ n: 1 }));
		const b = slot(name, 1, () => ({ n: 2 }));
		expect(b).toBe(a);
		expect(a.n).toBe(1);
	});

	it('lives where the hand-written slots lived, so a copy that predates slot() shares it', () => {
		const name = fresh();
		const old = { from: 'an older copy' };
		g[Symbol.for(name)] = old;
		expect(slot(name, 1, () => ({ from: 'new' }))).toBe(old);
	});

	it('a copy at another version is refused in dev: both versions named', () => {
		const name = fresh();
		slot(name, 1, () => ({}));
		expect(() => slot(name, 2, () => ({}))).toThrow(/machine_slot_version/);
		expect(() => slot(name, 2, () => ({}))).toThrow(/1.*2|2.*1/);
	});

	it('a name outside ogygia., or a version that is not a whole number, is refused', () => {
		expect(() => slot('other.thing' as `ogygia.${string}`, 1, () => ({}))).toThrow(
			/machine_bad_option/
		);
		expect(() => slot(fresh() as `ogygia.${string}`, 1.5, () => ({}))).toThrow(/version/);
	});
});
