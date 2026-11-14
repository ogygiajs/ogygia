// FOUND BY THE ALWAYS-ON SIMULATOR (seed 283674076, 40 actions, faults: delay,reorder).
// Signature ea5b23a61e: ssr-hydrate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: ea5b23a61e', () => {
	it('seed 283674076 no longer finds ssr-hydrate ea5b23a61e', async () => {
		const r = await run(283674076, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'ea5b23a61e')).toEqual([]);
	}, 120_000);
});
