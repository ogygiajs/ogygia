// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000002988, 40 actions, faults: none).
// Signature f5b1b0e576: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: f5b1b0e576', () => {
	it('seed 1000002988 no longer finds crash f5b1b0e576', async () => {
		const r = await run(1000002988, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'f5b1b0e576')).toEqual([]);
	}, 120_000);
});
