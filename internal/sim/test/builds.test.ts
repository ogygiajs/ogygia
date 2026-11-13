// Two builds of the same code are the same world: Kit's version was the build's moment, so every
// rebuild renamed the chunks it reaches, each request drew another fate, and a seed ran another run.
// A mutant's build is a rebuild: gen 208 seed 13 "killed" 18 federation mutants alike, one a log
// label's (run 3). Each sim build's version is its id.
import { describe, expect, it } from 'vitest';

const config = async (app: string, build?: string) => {
	const before = process.env.VITE_SIM_BUILD;
	if (build === undefined) delete process.env.VITE_SIM_BUILD;
	else process.env.VITE_SIM_BUILD = build;
	try {
		const url = new URL(`../../../apps/${app}/svelte.config.js`, import.meta.url);
		url.search = `?at=${build ?? 'none'}`;
		return ((await import(url.href)).default as { kit?: { version?: { name?: string } } }).kit
			?.version?.name;
	} finally {
		if (before === undefined) delete process.env.VITE_SIM_BUILD;
		else process.env.VITE_SIM_BUILD = before;
	}
};

describe("a sim build's Kit version", () => {
	it('is its build id, for the generated app and the palaestra', async () => {
		for (const app of ['sim-gen', 'palaestra']) {
			expect(await config(app, 'v1')).toBe('v1');
			expect(await config(app, 'v2')).toBe('v2');
		}
	});

	it('is left to Kit outside the simulator', async () => {
		for (const app of ['sim-gen', 'palaestra']) expect(await config(app)).toBeUndefined();
	});

	it("is the peer's own name for the generated peer (one build, never deployed)", async () => {
		expect(await config('sim-gen-peer')).toBe('peer');
	});
});
