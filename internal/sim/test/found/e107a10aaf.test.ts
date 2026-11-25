// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000000305, 40 actions, faults: none).
// Signature e107a10aaf: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: e107a10aaf', () => {
	it('seed 1000000305 no longer finds crash e107a10aaf', async () => {
		const r = await run(1000000305, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'e107a10aaf')).toEqual([]);
	}, 120_000);
});
