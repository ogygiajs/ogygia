// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000005450, 40 actions, faults: none).
// Signature 941f677cca: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 941f677cca', () => {
	it('seed 1000005450 no longer finds crash 941f677cca', async () => {
		const r = await run(1000005450, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '941f677cca')).toEqual([]);
	}, 120_000);
});
