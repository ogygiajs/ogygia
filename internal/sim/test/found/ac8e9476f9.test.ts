// FOUND BY THE ALWAYS-ON SIMULATOR (seed 270754003, 40 actions, faults: delay,reorder,redirect).
// Signature ac8e9476f9: ssr-hydrate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: ac8e9476f9', () => {
	it('seed 270754003 no longer finds ssr-hydrate ac8e9476f9', async () => {
		const r = await run(270754003, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'ac8e9476f9')).toEqual([]);
	}, 120_000);
});
