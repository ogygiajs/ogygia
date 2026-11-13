// Every property run through `@ogygia/config/sim`'s `fc` is seeded: a property that fails, fails on
// every CI run, and its seed replays it (OGYGIA_FUZZ_SEED tries another).
import { expect, it, vi } from 'vitest';
import { fc, sim_params } from '@ogygia/config/sim';
import { pluginTests, sim_define } from '@ogygia/config/vitest';

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

it('a browser test is handed the sim knobs the run was started with, and nothing else of its environment', () => {
	const env = { OGYGIA_SIM_RUNS: '2000', OGYGIA_SIM_SEED: '', OGYGIA_FUZZ_SEED: '7', HOME: '/h' };
	expect(sim_define(env)).toEqual({
		__OGYGIA_SIM_ENV__: JSON.stringify({ OGYGIA_SIM_RUNS: '2000', OGYGIA_FUZZ_SEED: '7' })
	});
	expect(pluginTests().define).toEqual(sim_define(process.env));
});

it('a property run reads its run count and seed from the sim knobs, else its own defaults', () => {
	const was = { runs: process.env.OGYGIA_SIM_RUNS, seed: process.env.OGYGIA_SIM_SEED };
	try {
		process.env.OGYGIA_SIM_RUNS = '12';
		process.env.OGYGIA_SIM_SEED = '';
		expect(sim_params({ runs: 60, seed: 1676 })).toEqual({ numRuns: 12, seed: 1676 });
		process.env.OGYGIA_SIM_RUNS = 'many';
		expect(() => sim_params({ runs: 60, seed: 1676 })).toThrow(
			/OGYGIA_SIM_RUNS must be a whole number/
		);
	} finally {
		if (was.runs === undefined) delete process.env.OGYGIA_SIM_RUNS;
		else process.env.OGYGIA_SIM_RUNS = was.runs;
		if (was.seed === undefined) delete process.env.OGYGIA_SIM_SEED;
		else process.env.OGYGIA_SIM_SEED = was.seed;
	}
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
