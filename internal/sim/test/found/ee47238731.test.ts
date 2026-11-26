// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000005188, 40 actions, faults: none).
// Signature ee47238731: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: ee47238731', () => {
	it('seed 1000005188 no longer finds crash ee47238731', async () => {
		const r = await run(1000005188, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'ee47238731')).toEqual([]);
	}, 120_000);
});
