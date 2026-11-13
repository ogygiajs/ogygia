// Work under a retry policy (policy.ts `under_policy`), as flights and outbox run it: a caller who
// already left gets STALE at once, and the work never starts.
import { expect, it, vi } from 'vitest';
import { policy, STALE } from '../src/index.ts';
import { under_policy } from '../src/policy.ts';

it('a caller whose signal already aborted gets STALE, and the work never runs', async () => {
	const work = vi.fn(async () => 'ran');
	const left = new AbortController();
	left.abort();
	expect(await under_policy(policy({ attempts: 3 }), work, left.signal)).toBe(STALE);
	expect(work).not.toHaveBeenCalled();
});
