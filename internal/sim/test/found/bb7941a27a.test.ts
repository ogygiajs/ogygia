// FOUND BY THE ALWAYS-ON SIMULATOR (seed 283674051, 40 actions, faults: none).
// Signature bb7941a27a: ssr-hydrate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: bb7941a27a', () => {
	it('seed 283674051 no longer finds ssr-hydrate bb7941a27a', async () => {
		const r = await run(283674051, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'bb7941a27a')).toEqual([]);
	}, 120_000);
});
