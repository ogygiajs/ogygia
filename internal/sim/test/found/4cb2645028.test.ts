// FOUND BY THE ALWAYS-ON SIMULATOR (seed 270754026, 40 actions, faults: none).
// Signature 4cb2645028: hung. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 4cb2645028', () => {
	it('seed 270754026 no longer finds hung 4cb2645028', async () => {
		const r = await run(270754026, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '4cb2645028')).toEqual([]);
	}, 120_000);
});
