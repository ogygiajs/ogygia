// A RECORDING HANDS THE CONSOLE BACK AS IT FOUND IT, WITH WHAT CAME AFTER. A session counts the page's
// `console.error` lines by wrapping it while it records. A tool the page loads later (an error
// reporter) may wrap it again on top. The session's stop must take only its own part away: setting
// `console.error` back to what it saw at the start throws the later wrapper out with it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { start_session } = await import('../src/devtools/session.ts');

const original = console.error;
beforeEach(() => {
	class Observer {
		observe(): void {}
		disconnect(): void {}
		takeRecords(): never[] {
			return [];
		}
	}
	vi.stubGlobal('MutationObserver', Observer);
	vi.stubGlobal('document', { body: {}, querySelectorAll: () => [] });
	vi.stubGlobal('location', { pathname: '/', search: '' });
	vi.stubGlobal('addEventListener', () => {});
	vi.stubGlobal('removeEventListener', () => {});
	vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
});
afterEach(() => {
	console.error = original;
	vi.unstubAllGlobals();
});

describe('a recording and the console', () => {
	it('a wrapper the page put on console.error during the recording stays after the stop', async () => {
		const reached: unknown[][] = [];
		console.error = (...args: unknown[]) => void reached.push(args);
		const rec = start_session();
		const under = console.error;
		const reporter_saw: unknown[] = [];
		const reporter = (...args: unknown[]) => {
			reporter_saw.push(args[0]);
			under(...args);
		};
		console.error = reporter;

		const data = await rec.stop();
		expect(console.error, 'the later wrapper is still on').toBe(reporter);
		console.error('after');
		expect(reporter_saw).toEqual(['after']);
		expect(reached.at(-1), 'and the line reaches the console under it').toEqual(['after']);
		expect(
			data.errors.map((e) => e.message),
			'the stopped recording counts nothing more'
		).toEqual([]);
	});

	it('with nothing on top, the stop puts console.error back as it was', async () => {
		const mine = (..._args: unknown[]) => {};
		console.error = mine;
		const rec = start_session();
		expect(console.error).not.toBe(mine);
		console.error('during');
		const data = await rec.stop();
		expect(console.error).toBe(mine);
		expect(data.errors.map((e) => e.message)).toEqual(['console.error: during']);
	});
});
