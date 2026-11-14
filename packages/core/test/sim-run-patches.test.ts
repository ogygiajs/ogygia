import { describe, expect, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';

const timeout_property = () => Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');

describe('a simulated run', () => {
	it("times AbortSignal.timeout on the run's clock, and gives the host's own back when it ends", async () => {
		const host = timeout_property();
		let signal: AbortSignal | undefined;
		let elapsed = -1;
		await fc.assert(
			fc.asyncProperty(fc.scheduler(), async (s) => {
				await simulate(s, async (sim) => {
					expect(timeout_property()?.value).not.toBe(host?.value);
					signal = AbortSignal.timeout(60_000);
					signal.addEventListener('abort', () => (elapsed = sim.elapsed()), { once: true });
					expect(signal.aborted).toBe(false);
				});
			}),
			{ numRuns: 1, seed: 1 }
		);
		expect(signal?.aborted).toBe(true);
		expect(elapsed).toBe(60_000);
		expect(timeout_property()).toEqual(host);
	});
});
