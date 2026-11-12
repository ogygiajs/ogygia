/**
 * The named retry policies (#313) give the waits, tries and deadlines the code had as bare numbers
 * before they were named: no behavior moved with them.
 */
import { describe, expect, it } from 'vitest';
import { backoffAfter } from '@ogygia/machine';
import * as policies from '../src/policies.ts';

/** The waits a policy gives between its tries, the jitter's random at its worst. */
const waits = (p: (typeof policies)[keyof typeof policies], random: number) =>
	Array.from({ length: p.attempts - 1 }, (_, i) => backoffAfter(p, i + 1, random));

describe('named policies keep the old numbers', () => {
	it('every one is jitter-free, so its waits are exact', () => {
		for (const p of Object.values(policies)) {
			expect(waits(p, 0)).toEqual(waits(p, 1));
			expect(p.jitter).toBe(0);
		}
	});

	it('download: one more try, at once (flights `retries: 1`)', () => {
		expect(policies.download.attempts).toBe(2);
		expect(waits(policies.download, 1)).toEqual([0]);
		expect(policies.download.deadline).toBe(Infinity);
	});

	it("devalue's download: asked again after 1, 2, 4 and 8 s, then left (RETRY_FIRST_MS doubling to RETRY_LAST_MS)", () => {
		expect(waits(policies.devalue_download, 1)).toEqual([1000, 2000, 4000, 8000]);
	});

	it("a hole's fetch: three tries, 500 ms × the tries failed so far between them", () => {
		expect(policies.region_fetch.attempts).toBe(3);
		expect(waits(policies.region_fetch, 1)).toEqual([500 * 1, 500 * 2]);
	});

	it("a rate-limited hole: region_fetch's tries, each wait at most a minute (#959)", () => {
		expect(policies.region_rate_limited.attempts).toBe(policies.region_fetch.attempts);
		expect(waits(policies.region_rate_limited, 1)).toEqual([60_000, 60_000]);
	});

	it('render and stream: one try, 10 s (RENDER_TIMEOUT_MS, STALL_MS)', () => {
		for (const p of [policies.render, policies.stream]) {
			expect(p.attempts).toBe(1);
			expect(p.deadline).toBe(10_000);
		}
	});
});
