// FOUND BY THE ALWAYS-ON SIMULATOR (seed 270754014, 40 actions, faults: none).
// Signature 0397b00705: hung. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 0397b00705', () => {
	it('seed 270754014 no longer finds hung 0397b00705', async () => {
		const r = await run(270754014, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '0397b00705')).toEqual([]);
	}, 120_000);
});
