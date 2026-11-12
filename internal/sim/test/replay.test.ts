// One seed, one run: the same seed twice gives the same trace, byte for byte (every loop task, every
// action, each tab's URL and DOM fingerprint). Seed 11 once differed: a live answer's body was read
// whole before delivery (it never ends) and the app's query cache let go of entries on the host's
// garbage collection. (Skipped without `OGYGIA_RULES=1 vite build` in apps/palaestra.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run, trace_difference } from '../src/cli.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('replay', () => {
	for (const seed of [1, 3, 11]) {
		it(`seed ${seed} runs the same twice`, async () => {
			const a = await run(seed, 8);
			const b = await run(seed, 8);
			expect(trace_difference(a.log, b.log)).toBe('');
		}, 300_000);
	}
});
