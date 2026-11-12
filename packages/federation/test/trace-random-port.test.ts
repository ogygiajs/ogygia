// A hop's trace ids come from the realm's randomness (the `random` port), so a simulated run owns
// them. Node's own `randomBytes` was the process's: a seeded run of a federated app did not replay.
import { afterEach, expect, it, vi } from 'vitest';
import { child_traceparent } from '../src/wire.ts';

afterEach(() => vi.restoreAllMocks());

it("a new trace's ids are drawn from the realm's randomness", () => {
	vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T>(array: T): T => {
		(array as unknown as Uint8Array).fill(0xab);
		return array;
	});
	const { trace_id, span_id } = child_traceparent();
	expect(trace_id).toBe('ab'.repeat(16));
	expect(span_id).toBe('ab'.repeat(8));
});
