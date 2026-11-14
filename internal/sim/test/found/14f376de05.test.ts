// FOUND BY THE ALWAYS-ON SIMULATOR (seed 283674073, 40 actions, faults: delay,reorder,cut).
// Signature 14f376de05: ssr-hydrate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 14f376de05', () => {
	it('seed 283674073 no longer finds ssr-hydrate 14f376de05', async () => {
		const r = await run(283674073, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '14f376de05')).toEqual([]);
	}, 120_000);
});
