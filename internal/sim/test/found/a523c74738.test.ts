// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000015616, 40 actions, faults: delay,tamper,redirect).
// Signature a523c74738: stuck. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: a523c74738', () => {
	it('seed 1000015616 no longer finds stuck a523c74738', async () => {
		const r = await run(1000015616, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'a523c74738')).toEqual([]);
	}, 120_000);
});
