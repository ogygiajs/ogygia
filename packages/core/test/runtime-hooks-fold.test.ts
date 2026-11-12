import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { RUNTIME_HOOK_CONSTANTS, type RuntimeHookName } from '../src/contract/runtime-hooks.ts';
import { dedent } from '../src/contract/dedent.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ENTRY = dedent`
	import { boot } from ${JSON.stringify(`${SRC}runtime/core.ts`)};
	import { install as frames } from ${JSON.stringify(`${SRC}runtime/frames.ts`)};
	import { install as router } from ${JSON.stringify(`${SRC}runtime/router.ts`)};
	boot([frames, router], [{ boot() {} }]);
`;
const HOOKS = Object.keys(RUNTIME_HOOK_CONSTANTS) as RuntimeHookName[];

async function build(subscribed: readonly RuntimeHookName[]): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), 'og-hooks-'));
	const file = join(dir, 'entry.mjs');
	writeFileSync(file, ENTRY);
	const hook_defines = Object.fromEntries(
		HOOKS.map((h) => [RUNTIME_HOOK_CONSTANTS[h], String(subscribed.includes(h))])
	);
	const bundle = await rolldown({
		input: file,
		external: [/^svelte(\/|$)/, /^\$app\//, 'esm-env', /\.svelte$/, /^node:/],
		transform: {
			define: {
				'import.meta.env.DEV': 'false',
				'import.meta.env.MODE': '"production"',
				__OGYGIA_DEVTOOLS__: 'false',
				__OGYGIA_CLIENT_PLUGINS__: 'true',
				__OGYGIA_RULES__: 'false',
				...hook_defines
			}
		},
		logLevel: 'silent'
	});
	const { output } = await bundle.generate({ format: 'esm', minify: true });
	await bundle.close();
	return output.map((o) => ('code' in o ? o.code : '')).join('\n');
}

describe('runtime hooks', () => {
	it('a build where no plugin subscribes carries no hook code; each subscribed hook brings its own', async () => {
		const none = await build([]);
		const all = await build(HOOKS);
		const hydrated = await build(['regionHydrated']);
		// (whole names: `regionHydrate` is a prefix of `regionHydrated`)
		const named = (hook: string) => new RegExp(`\\b${hook}\\b`);
		for (const hook of HOOKS.filter((h) => h !== 'warning')) {
			expect(none, hook).not.toMatch(named(hook));
			expect(all, hook).toMatch(named(hook));
		}
		for (const fan_out of ['.hooks', 'tLoaded:', 'finalPath:', 'finalUrl:'])
			expect(none, fan_out).not.toContain(fan_out);
		// (a plugin's boot is isolated as a hook is: a throw is reported, the regions still wake)
		expect(none).toContain('client_hook_failed');
		expect(all).toContain('client_hook_failed');
		const freezes = (s: string) => s.split('Object.freeze').length;
		expect(freezes(all)).toBe(freezes(none));
		expect(hydrated).toContain('regionHydrated');
		expect(hydrated).toContain('tLoaded:');
		for (const other of HOOKS.filter((h) => h !== 'regionHydrated' && h !== 'warning'))
			expect(hydrated, other).not.toMatch(named(other));
		expect(none.length).toBeLessThan(hydrated.length);
	}, 60_000);
});
