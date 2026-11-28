// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000015686, 40 actions, faults: delay,tamper).
// Signature 36a5de3ece: leak. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 36a5de3ece', () => {
	it('seed 1000015686 no longer finds leak 36a5de3ece', async () => {
		const r = await run(1000015686, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '36a5de3ece')).toEqual([]);
	}, 120_000);
});
