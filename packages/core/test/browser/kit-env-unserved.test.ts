// KIT'S ENV MODULE THAT DOES NOT LOAD (KIT-PUBLIC-ENV, #2212): a prerendered page's regions wait for
// `_app/env.js`; when it fails they still run, a module that reads the env reads it empty and says so,
// and the next region's code asks for it again. Its own file: a module that failed stays in this
// frame's module map.
import { afterEach, expect, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { PLAYWRIGHT, it_with_network_routes } from './_browsers.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

(globalThis as { __OGYGIA_KIT_MAJOR__?: number }).__OGYGIA_KIT_MAJOR__ = 3;
const { hold_code_for_env } = await import('../../src/runtime/kit-env-first.ts');
const { import_file } = await import('../../src/runtime/import-again.ts');
const { code_url_or_refuse } = await import('../../src/runtime/code-origins.ts');

const ENV = '/test/browser/fixtures/kit-app/env.js';
const ISLAND = '/test/browser/fixtures/reads-kit-env.ts';
const MARK = 'e'.repeat(24);
const load = (copy: string) =>
	import_file<{ env: Record<string, unknown> }>(code_url_or_refuse(`${ISLAND}?${copy}`));

afterEach(async () => {
	vi.restoreAllMocks();
	if (PLAYWRIGHT) await commands.keep_downloads(ENV);
});

it_with_network_routes(
	"a prerendered page whose env module does not load: its regions run, one that reads the env reads it empty and says kit_env_missing, and the next region's code asks again",
	async () => {
		await commands.drop_downloads(ENV, 10);
		const { link_boot } = await import('../../src/runtime/boot-link.ts');
		const { init } = await import('../../src/runtime/lazy-link.ts');
		init(link_boot());
		const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const runtime = document.createElement('script');
		runtime.type = 'application/x-runtime-stand-in';
		runtime.setAttribute('data-ogygia-runtime', '');
		runtime.setAttribute('data-og-mark', MARK);
		const ask = document.createElement('script');
		ask.type = 'application/ogygia-env-served';
		ask.setAttribute('data-og-mark', MARK);
		document.head.prepend(runtime, ask);
		hold_code_for_env();

		expect((await load('dropped')).env).toEqual({});
		await expect.poll(() => said.mock.calls.flat().join(' ')).toContain('kit_env_missing');
		expect(said.mock.calls.flat().join(' ')).toMatch(/why=unserved|is prerendered/);

		await commands.keep_downloads(ENV);
		expect((await load('asked-again')).env).toEqual({ PUBLIC_REGION: 'deployed' });
	}
);
