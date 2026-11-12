/**
 * say(): edge-triggered reporting (#438). A thing is said once per key until it recovers, and a
 * reporter remembers a bounded number of keys, so a long-lived server never grows with every
 * distinct message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { say } from '../src/index.ts';
import { warn_once } from '../src/messages.ts';

afterEach(() => vi.restoreAllMocks());

describe('say()', () => {
	it('says a key once, however often it comes', () => {
		const said: string[] = [];
		const warnings = say();
		for (let i = 0; i < 5; i++) warnings.once('down', () => said.push('down'));
		expect(said).toEqual(['down']);
	});

	it('says each key once: once per key', () => {
		const said: string[] = [];
		const warnings = say();
		for (const key of ['a', 'b', 'a', 'c', 'b']) warnings.once(key, () => said.push(key));
		expect(said).toEqual(['a', 'b', 'c']);
	});

	it('a failure after a recovery is said again: once per failing streak', () => {
		const said: number[] = [];
		const sink = say();
		sink.once('sink', () => said.push(1));
		sink.once('sink', () => said.push(2)); // the same streak
		sink.ok('sink'); // it recovered
		sink.once('sink', () => said.push(3)); // a new streak
		expect(said).toEqual([1, 3]);
	});

	it('10,000 distinct keys keep at most the bound', () => {
		const warnings = say({ max: 256 });
		for (let i = 0; i < 10_000; i++) warnings.once(`/page/${i}`, () => {});
		expect(warnings.size).toBeLessThanOrEqual(256);
		// the most recent keys are the ones remembered
		let again = false;
		warnings.once('/page/9999', () => (again = true));
		expect(again).toBe(false);
	});

	it('a key that comes again is kept over one said once long ago, when the bound lets one go', () => {
		const warnings = say({ max: 2 });
		const said: string[] = [];
		const tell = (key: string) => warnings.once(key, () => said.push(key));
		tell('a');
		tell('b');
		tell('a'); // still true: not said, but now the most recent
		tell('c'); // past the bound: `b` goes, not `a`
		tell('a');
		tell('b');
		expect(said).toEqual(['a', 'b', 'c', 'b']);
	});

	it('remembers 1024 keys by default', () => {
		const warnings = say();
		for (let i = 0; i < 10_000; i++) warnings.once(`k${i}`, () => {});
		expect(warnings.size).toBe(1024);
	});

	it('a bound that is not a whole number above 0 is refused', () => {
		expect(() => say({ max: 0 })).toThrow();
		expect(() => say({ max: Infinity })).toThrow();
	});
});

describe('warn_once', () => {
	it('10,000 distinct warnings keep at most 1024: the oldest is said again', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const args = (i: number) => ({ name: `m${i}`, from: 'a', to: 'b' });
		for (let i = 0; i < 10_000; i++) warn_once('machine_illegal_move', args(i));
		expect(warn).toHaveBeenCalledTimes(10_000);
		warn_once('machine_illegal_move', args(0));
		expect(warn).toHaveBeenCalledTimes(10_001);
		warn_once('machine_illegal_move', args(9_999));
		expect(warn).toHaveBeenCalledTimes(10_001);
	});
});
