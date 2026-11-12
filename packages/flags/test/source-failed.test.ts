// A flag source that fails (a vendor down, an OFREP endpoint answering 500, one flag's evaluation
// throwing) degrades its flags to their native rule, and must say so: a source that is down for a
// week otherwise looks like a source that decided nothing. Said once per failing streak, like the
// exposure sink: again only after a request it served worked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decide, flag, prime_flags } from '../src/index.ts';
import { ofrep } from '../src/ofrep.ts';
import { openfeature } from '../src/openfeature.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import server from '../src/server.ts';

startPlugin(server, { name: '@ogygia/flags' });

/** How long a request waits for a flag source (src/index.ts); a constant here so the test fails on
 *  a source that has none (it would wait forever). */
const SOURCE_DEADLINE_MS = 1_000;

const ctx = () => {
	const url = 'http://s/x';
	return {
		request: new Request(url),
		url: new URL(url),
		cookies: { get: (n: string) => (n === 'og-vid' ? 'v1' : undefined) }
	};
};

let warns: unknown[][];
beforeEach(() => {
	warns = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		warns.push(a);
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	decide({ source: undefined });
});

const said = () => warns.filter((a) => String(a[0]).includes('flags_source_failed'));

describe('a failing flag source is said', () => {
	it('a source that throws: said once for its failing streak, with the error, again after a request worked', async () => {
		let down = true;
		decide({
			source: () => {
				if (down) throw new Error('vendor down');
				return {};
			}
		});
		const f = flag('sf-a', 100);
		const c = ctx();
		await prime_flags(c);
		expect(f(c)).toBe(true); // native still decides
		await prime_flags(ctx());
		expect(said()).toHaveLength(1);
		expect((said()[0][1] as Error).message).toBe('vendor down');

		down = false;
		await prime_flags(ctx());
		down = true;
		await prime_flags(ctx());
		expect(said()).toHaveLength(2);
	});

	it('an OFREP endpoint that answers 500', async () => {
		decide({
			source: ofrep({
				url: 'http://flags.test',
				fetch: (async () => new Response('down', { status: 500 })) as typeof fetch
			})
		});
		flag('sf-b');
		await prime_flags(ctx());
		expect(said()).toHaveLength(1);
	});

	it('an OFREP endpoint that cannot be reached', async () => {
		decide({
			source: ofrep({
				url: 'http://flags.test',
				fetch: (async () => {
					throw new TypeError('fetch failed');
				}) as typeof fetch
			})
		});
		flag('sf-c');
		await prime_flags(ctx());
		expect(said()).toHaveLength(1);
	});

	it("an OpenFeature flag whose evaluation throws: said, and the other flags keep the source's answer", async () => {
		decide({
			source: openfeature({
				async getBooleanValue(key: string) {
					if (key === 'sf-broken') throw new Error('provider not ready');
					return false;
				},
				getStringValue: async (_k: string, d: string) => d
			})
		});
		const broken = flag('sf-broken', 100);
		const fine = flag('sf-fine', 100);
		const c = ctx();
		await prime_flags(c);
		expect(broken(c)).toBe(true); // native
		expect(fine(c)).toBe(false); // the source's answer
		expect(said()).toHaveLength(1);
	});

	it('a source that never answers holds no request: past its deadline the flags fall to their native rule, and it is said', async () => {
		vi.useFakeTimers();
		try {
			decide({ source: () => new Promise(() => {}) });
			const f = flag('sf-hangs', 100);
			const c = ctx();
			let primed = false;
			void prime_flags(c).then(() => (primed = true));
			await vi.advanceTimersByTimeAsync(SOURCE_DEADLINE_MS + 1);
			expect(primed).toBe(true);
			expect(f(c)).toBe(true); // native decides
			expect(said()).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a request where one flag still fails does not end the streak, though the source answered the rest', async () => {
		decide({
			source: openfeature({
				async getBooleanValue(key: string) {
					if (key === 'sf-broken-2') throw new Error('provider not ready');
					return false;
				},
				getStringValue: async (_k: string, d: string) => d
			})
		});
		flag('sf-broken-2', 100);
		flag('sf-fine-2', 100);
		await prime_flags(ctx());
		await prime_flags(ctx());
		await prime_flags(ctx());
		expect(said()).toHaveLength(1);
	});
});
