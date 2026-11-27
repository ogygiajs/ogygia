// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000007615, 40 actions, faults: none).
// Signature 17fe5c5c94: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 17fe5c5c94', () => {
	it('seed 1000007615 no longer finds crash 17fe5c5c94', async () => {
		const r = await run(1000007615, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '17fe5c5c94')).toEqual([]);
	}, 120_000);
});
