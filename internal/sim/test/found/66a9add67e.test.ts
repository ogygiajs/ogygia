// FOUND BY THE ALWAYS-ON SIMULATOR (seed 283674001, 40 actions, faults: reorder,duplicate,stall).
// Signature 66a9add67e: ssr-hydrate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 66a9add67e', () => {
	it('seed 283674001 no longer finds ssr-hydrate 66a9add67e', async () => {
		const r = await run(283674001, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '66a9add67e')).toEqual([]);
	}, 120_000);
});
