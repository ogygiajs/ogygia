// FOUND BY THE ALWAYS-ON SIMULATOR (seed 270754039, 40 actions, faults: duplicate,redirect,stall).
// Signature 2a6267dbca: ssr-hydrate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 2a6267dbca', () => {
	it('seed 270754039 no longer finds ssr-hydrate 2a6267dbca', async () => {
		const r = await run(270754039, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '2a6267dbca')).toEqual([]);
	}, 120_000);
});
