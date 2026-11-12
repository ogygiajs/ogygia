// TWO PRIMES OF ONE REQUEST AT ONCE (#296). The request's source answer was claimed with an empty
// map before the source answered, and that claim looked the same as "the source decided nothing": a
// second prime of the same request while the first waited returned at once, and a read after it fell
// through to the native rule instead of the source's answer.
import { afterEach, describe, expect, it } from 'vitest';
import { decide, flag, prime_flags } from '../src/index.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import server from '../src/server.ts';

startPlugin(server, { name: '@ogygia/flags' });

afterEach(() => {
	decide({ source: undefined });
});

describe('a second prime of a request while the first waits', () => {
	it('returns once the source answered, and reads get its answer', async () => {
		let answer!: () => void;
		const answered = new Promise<void>((r) => (answer = r));
		decide({
			source: async () => {
				await answered;
				return { 'prime-twice': false };
			}
		});
		const f = flag('prime-twice', 100); // native: on for everyone
		const url = 'http://s/x';
		const c = {
			request: new Request(url),
			url: new URL(url),
			cookies: { get: (n: string) => (n === 'og-vid' ? 'v1' : undefined) }
		};
		const first = prime_flags(c);
		let second_done = false;
		const second = prime_flags(c).then(() => (second_done = true));
		await new Promise((r) => setTimeout(r, 20));
		expect(second_done).toBe(false); // still waiting with the first
		answer();
		await Promise.all([first, second]);
		expect(f(c)).toBe(false); // the source's answer, not the native rule
	});
});

describe('a source that throws before it awaits anything', () => {
	it('leaves the request resolved (empty), never priming for good', async () => {
		decide({
			source: () => {
				throw new Error('vendor down');
			}
		});
		flag('prime-sync-throw', 100);
		const url = 'http://s/y';
		const c = {
			request: new Request(url),
			url: new URL(url),
			cookies: { get: () => undefined }
		};
		await prime_flags(c);
		// (the request's source answer, where the flags keep it)
		const prime = (c.request as unknown as Record<symbol, { kind: string }>)[
			Symbol.for('ogygia.flags.resolved')
		];
		expect(prime.kind).toBe('resolved');
	});
});
