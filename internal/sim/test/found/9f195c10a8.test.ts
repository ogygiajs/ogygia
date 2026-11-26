// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000004158, 40 actions, faults: delay,reorder,drop,duplicate,stall).
// Signature 9f195c10a8: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 9f195c10a8', () => {
	it('seed 1000004158 no longer finds mpa-equivalence 9f195c10a8', async () => {
		const r = await run(1000004158, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '9f195c10a8')).toEqual([]);
	}, 120_000);
});
