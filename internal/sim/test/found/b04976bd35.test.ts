// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000001366, 40 actions, faults: none).
// Signature b04976bd35: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: b04976bd35', () => {
	it('seed 1000001366 no longer finds crash b04976bd35', async () => {
		const r = await run(1000001366, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'b04976bd35')).toEqual([]);
	}, 120_000);
});
