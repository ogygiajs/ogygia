// The machine package's module-level collections are bounded and owned (#413): what a long-lived
// page or server process keeps does not grow without end.
import { afterEach, expect, it, vi } from 'vitest';
import { machine, observe } from '../src/index.ts';
import { warn_once } from '../src/messages.ts';

afterEach(() => vi.restoreAllMocks());

it('the once-per-warning memory is bounded: past its size, the oldest warning can be said again', () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const say = (i: number) =>
		warn_once('machine_illegal_move', { name: `m${i}`, from: 'a', to: 'b' });
	say(0);
	say(0);
	expect(warn).toHaveBeenCalledTimes(1);
	// (say() remembers the latest 1024: these push the first one out)
	for (let i = 1; i <= 1024; i++) say(i);
	warn.mockClear();
	say(0); // long ago: no longer remembered
	expect(warn).toHaveBeenCalledTimes(1);
	say(1024); // just said: still remembered
	expect(warn).toHaveBeenCalledTimes(1);
});

it('observers are kept until each stops, and hear moves in the order they started watching', () => {
	const heard: string[] = [];
	const m = machine<{ a: {}; b: {} }>()({
		name: 'observed',
		initial: 'a',
		steps: { a: ['b'], b: ['a'] }
	}).create();
	const off1 = observe((name) => name === 'observed' && heard.push('1'));
	const off2 = observe((name) => name === 'observed' && heard.push('2'));
	m.go('b');
	off1();
	m.go('a');
	off2();
	m.go('b');
	expect(heard).toEqual(['1', '2', '2']);
});
