// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000012883, 40 actions, faults: reorder,cut,tamper,stall).
// Signature fdad17476f: islands-wake. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: fdad17476f', () => {
	it('seed 1000012883 no longer finds islands-wake fdad17476f', async () => {
		const r = await run(1000012883, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'fdad17476f')).toEqual([]);
	}, 120_000);
});
