// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000015856, 40 actions, faults: delay,drop,redirect,stall).
// Signature cf61e417aa: islands-wake. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: cf61e417aa', () => {
	it('seed 1000015856 no longer finds islands-wake cf61e417aa', async () => {
		const r = await run(1000015856, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'cf61e417aa')).toEqual([]);
	}, 120_000);
});
