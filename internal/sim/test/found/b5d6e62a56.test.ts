// FOUND BY THE ALWAYS-ON SIMULATOR (seed 270754016, 40 actions, faults: delay,cut,redirect).
// Signature b5d6e62a56: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: b5d6e62a56', () => {
	it('seed 270754016 no longer finds page-errors b5d6e62a56', async () => {
		const r = await run(270754016, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'b5d6e62a56')).toEqual([]);
	}, 120_000);
});
