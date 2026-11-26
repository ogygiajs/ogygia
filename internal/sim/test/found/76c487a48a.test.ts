// FOUND BY THE ALWAYS-ON SIMULATOR (seed 1000002850, 40 actions, faults: none).
// Signature 76c487a48a: crash. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 76c487a48a', () => {
	it('seed 1000002850 no longer finds crash 76c487a48a', async () => {
		const r = await run(1000002850, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '76c487a48a')).toEqual([]);
	}, 120_000);
});
