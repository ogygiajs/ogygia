// The production build: a wrong move is refused, not thrown, and printed once. The browser bundle
// drops the wording and prints the code's page alone.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('esm-env', () => ({ DEV: false, BROWSER: true, NODE: false }));

const { cache, machine } = await import('../src/index.ts');

describe('production: a cache with no bound', () => {
	afterEach(() => vi.restoreAllMocks());

	it('is refused, not thrown: it keeps nothing, and the code is printed', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const c = cache<string, number>({ max: Infinity });
		expect(c.set('a', 1)).toBe(false);
		expect(c.get('a')).toBeUndefined();
		expect(error).toHaveBeenCalledOnce();
		expect(String(error.mock.calls[0]![0])).toContain('machine_bad_option');
	});
});

const light = machine<{ red: {}; green: { since: number }; off: {} }>()({
	name: 'light',
	initial: 'red',
	steps: { red: ['green', 'off'], green: ['red'], off: [] }
});

describe('production', () => {
	afterEach(() => vi.restoreAllMocks());

	it('refuses a wrong move: false, stays put, prints the link once', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const m = light.create();
		const untyped = m.go.bind(m) as (to: string) => boolean;
		m.go('off');
		expect(untyped('red')).toBe(false);
		expect(untyped('red')).toBe(false);
		expect(m.now.kind).toBe('off');
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toBe(
			'[ogygia] https://ogygiajs.dev/e/machine_illegal_move?name=light&from=off&to=red'
		);
	});

	it('prints again for a different wrong move', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const m = light.create();
		const untyped = m.move.bind(m) as (from: string, to: string) => boolean;
		expect(untyped('green', 'off')).toBe(false);
		expect(warn).toHaveBeenCalledOnce();
		expect(m.now.kind).toBe('red');
	});

	it('does not freeze data values (a production build skips the dev-only copy checks)', () => {
		const m = light.create();
		m.go('green', { since: 1 });
		expect(Object.isFrozen(m.now)).toBe(false);
		expect(m.now).toEqual({ kind: 'green', since: 1 });
	});

	it('a saved now still tells two visits to one dataless state apart', () => {
		const m = light.create();
		const mine = m.now;
		m.go('green', { since: 1 });
		m.go('red');
		expect(m.now).toEqual(mine);
		expect(m.now).not.toBe(mine);
	});

	it('skips the definition checks but still refuses an initial that is not a state', () => {
		expect(() =>
			machine<{ a: {}; b: {} }>()({ name: 'loose', initial: 'a', steps: { a: [], b: [] } })
		).not.toThrow(); // `b` unreachable: a dev check only
		expect(() =>
			machine<{ a: {} }>()({ name: 'broken', initial: 'z' as 'a', steps: { a: [] } })
		).toThrow('https://ogygiajs.dev/e/machine_unknown_state');
	});

	it('wait for a state that does not exist is STALE, not a throw', async () => {
		const { STALE } = await import('../src/index.ts');
		const m = light.create();
		await expect((m.wait as (k: string) => Promise<unknown>)('nope')).resolves.toBe(STALE);
	});

	it('a step to a state that does not exist is skipped by wait() and paths() too, not a throw (#358)', async () => {
		const { STALE } = await import('../src/index.ts');
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		// (`zz`: a misspelled step dev refuses; production keeps the definition)
		const loose = machine<{ a: {}; b: {}; c: {} }>()({
			name: 'misspelled',
			initial: 'a',
			steps: { a: ['b'], b: ['zz' as 'c', 'c'], c: [] }
		});
		const m = loose.create();
		const reached = m.wait('c');
		m.go('b');
		const never = m.wait('a'); // (no step leads back to a)
		expect((m.go as (to: string) => boolean)('zz')).toBe(false);
		m.go('c');
		await expect(reached).resolves.toEqual({ kind: 'c' });
		await expect(never).resolves.toBe(STALE);
		expect(loose.paths()).toEqual([
			['a', 'b'],
			['a', 'b', 'c']
		]);
	});
});
