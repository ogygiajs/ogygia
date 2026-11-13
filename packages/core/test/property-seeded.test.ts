// Every property run through `@ogygia/config/sim`'s `fc` is seeded: a property that fails, fails on
// every CI run, and its seed replays it (OGYGIA_FUZZ_SEED tries another).
import { expect, it, vi } from 'vitest';
import { fc } from '@ogygia/config/sim';

/** The inputs one property is given, in order. */
function inputs(): string[] {
	const seen: string[] = [];
	fc.assert(
		fc.property(fc.string(), (s) => {
			seen.push(s);
		}),
		{ numRuns: 20 }
	);
	return seen;
}

it('a property with no seed of its own tries the same inputs every run', () => {
	expect(Number.isSafeInteger(fc.readConfigureGlobal().seed)).toBe(true);
	expect(fc.readConfigureGlobal().seed).toBe(Number(process.env.OGYGIA_FUZZ_SEED || 314));
	expect(inputs()).toEqual(inputs());
});

it('a seed that is not a whole number fails loudly, never runs as NaN', async () => {
	const was = process.env.OGYGIA_FUZZ_SEED;
	process.env.OGYGIA_FUZZ_SEED = 'abc';
	vi.resetModules();
	try {
		await expect(import('@ogygia/config/sim')).rejects.toThrow(
			/OGYGIA_FUZZ_SEED must be a whole number/
		);
	} finally {
		if (was === undefined) delete process.env.OGYGIA_FUZZ_SEED;
		else process.env.OGYGIA_FUZZ_SEED = was;
		vi.resetModules();
	}
});
