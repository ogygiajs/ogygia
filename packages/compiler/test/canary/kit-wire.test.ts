/**
 * CANARY (#1718, #1857): `ogygia:server/kit-wire` re-exports names from SvelteKit's own
 * `src/runtime/shared.js` (compiler virtual/core.ts `kit_wire`). Every name it re-exports must be a
 * function that file exports, in every Kit the workspace installs, or the server build fails on a
 * missing export the day a consumer imports it.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { kit_wire } from '../../src/virtual/core.ts';
import { broke, KITS, type Internal } from '../../../core/test/canary/upstream.ts';

const WIRE: Internal = {
	upstream: "SvelteKit's shared runtime helpers (`src/runtime/shared.js`)",
	used_by: [
		'packages/compiler/src/virtual/core.ts (kit_wire)',
		'packages/core/src/hooks.ts (the remote seed)'
	],
	issue: 1857
};

/** The parameters core's contract (`KitWireModule`) gives each re-exported function. */
const PARAMS: Readonly<Record<string, number>> = { create_remote_key: 2 };

describe.each(Object.entries(KITS))('%s', (_, root) => {
	it('exports every name ogygia:server/kit-wire re-exports, taking the parameters the contract types', async () => {
		const shared = (await import(
			pathToFileURL(path.join(root, 'src', 'runtime', 'shared.js')).href
		)) as Record<string, unknown>;
		for (const name of Object.keys(kit_wire.exports ?? {})) {
			expect(typeof shared[name], broke(WIRE, `shared.js exports no \`${name}\``)).toBe('function');
			expect(
				(shared[name] as (...a: unknown[]) => unknown).length,
				broke(WIRE, `\`${name}\` takes another number of parameters than KitWireModule types`)
			).toBe(PARAMS[name]);
		}
	});
});
