// Every module the build transforms passes through the transportable checks, so a module that cannot
// hold a wire class or a createContext export is answered from its text, never parsed or scanned.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ parse: 0, scan: 0 }));

vi.mock('../src/compiler/parse/oxc.ts', async (orig) => {
	const real = await orig<typeof import('../src/compiler/parse/oxc.ts')>();
	return {
		...real,
		parse_module: (...a: Parameters<typeof real.parse_module>) => {
			calls.parse++;
			return real.parse_module(...a);
		}
	};
});
vi.mock('../src/compiler/parse/scan.ts', async (orig) => {
	const real = await orig<typeof import('../src/compiler/parse/scan.ts')>();
	return {
		...real,
		component_blocks: (...a: Parameters<typeof real.component_blocks>) => {
			calls.scan++;
			return real.component_blocks(...a);
		}
	};
});

const {
	appendTransportRegistrations,
	moduleHasTransportable,
	svelteModuleHasTransportable,
	svelte_module_registration
} = await import('../src/compiler/transportables.ts');

beforeEach(() => {
	calls.parse = 0;
	calls.scan = 0;
});

describe('a module that cannot hold a transportable is never parsed', () => {
	it('no `class`: the registration does not parse', () => {
		expect(appendTransportRegistrations('export const n = 1;', '/app/src/m.ts', '/app')).toBe(null);
		expect(calls.parse).toBe(0);
	});

	it('a `createContext` alone is not parsed: a context registers nothing', () => {
		expect(
			appendTransportRegistrations(
				"import { createContext } from 'ogygia';\nexport const c = createContext('c');",
				'/app/src/m.ts',
				'/app'
			)
		).toBe(null);
		expect(calls.parse).toBe(0);
	});

	it('a class with no `static`: the eager manifest does not parse', () => {
		expect(moduleHasTransportable('export class A {}', '/app/src/m.ts')).toBe(false);
		expect(calls.parse).toBe(0);
	});

	it('a component without the word `module` is never scanned for a module script', () => {
		const src = '<script>class A { static x = 1; }</script><p></p>';
		expect(svelteModuleHasTransportable(src, '/app/src/A.svelte')).toBe(false);
		expect(calls.scan).toBe(0);
	});

	it('a component with no `class` is never scanned for a registration', () => {
		expect(
			svelte_module_registration('<script module>let n = 1;</script>', '/app/A.svelte', '/app')
		).toBe(null);
		expect(calls.scan).toBe(0);
	});
});
