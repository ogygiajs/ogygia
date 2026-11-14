// FOUND BY THE ALWAYS-ON SIMULATOR (seed 283674021, 40 actions, faults: duplicate,cut,tamper).
// Signature caebc3297d: ssr-hydrate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: caebc3297d', () => {
	it('seed 283674021 no longer finds ssr-hydrate caebc3297d', async () => {
		const r = await run(283674021, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'caebc3297d')).toEqual([]);
	}, 120_000);
});
