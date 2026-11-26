// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000006990, 40 actions, faults: none).
// Signature df8ce11ea7: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: df8ce11ea7', () => {
	it('seed 1000006990 no longer finds crash df8ce11ea7', async () => {
		const r = await run(1000006990, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'df8ce11ea7')).toEqual([]);
	}, 120_000);
});
