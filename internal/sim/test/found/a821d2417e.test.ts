// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000008673, 40 actions, faults: none).
// Signature a821d2417e: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: a821d2417e', () => {
	it('seed 1000008673 no longer finds crash a821d2417e', async () => {
		const r = await run(1000008673, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'a821d2417e')).toEqual([]);
	}, 120_000);
});
