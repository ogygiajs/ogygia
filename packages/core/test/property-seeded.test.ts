// Every property run through `@ogygia/config/sim`'s `fc` is seeded: a property that fails, fails on
// every CI run, and its seed replays it (OGYGIA_FUZZ_SEED tries another).
import { expect, it } from 'vitest';
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
	expect(fc.readConfigureGlobal().seed).toBe(Number(process.env.OGYGIA_FUZZ_SEED || 314));
	expect(inputs()).toEqual(inputs());
});
