// KIT'S ENV OF A PRERENDERED PAGE (KIT-PUBLIC-ENV, #2212): its HTML is the build's and its dynamic
// public env the deployed server's, so the page carries no value, only the server's marked ask. The
// runtime loads Kit's `_app/env.js` before any region's module of that page runs, and Kit's patched
// `$app/env/public` reads it from there. The module's URL is the build's own, never the page's. Each
// test reads its own copy of the island (its own query); the env is served once per document, so a
// test that must find none served comes first.
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from 'vitest';
import { stringify } from 'devalue';
import { Downloads } from '@ogygia/tooling/vitest/downloads';
import { FIXTURE_BUILD } from '../_stubs/server.kit-env.ts';

(globalThis as { __OGYGIA_KIT_MAJOR__?: number }).__OGYGIA_KIT_MAJOR__ = 3;
const { hold_code_for_env, env_served_to } = await import('../../src/runtime/kit-env-first.ts');
const { import_file } = await import('../../src/runtime/import-again.ts');
const { code_url_or_refuse } = await import('../../src/runtime/code-origins.ts');
const { kit_env, kit_env_url } = await import('../../src/runtime/kit-env.ts');
const { link_boot } = await import('../../src/runtime/boot-link.ts');
const { init } = await import('../../src/runtime/lazy-link.ts');

const ISLAND = '/test/browser/fixtures/reads-kit-env.ts';
const MARK = 'd'.repeat(24);
const load = (copy: string) =>
	import_file<{ env: Record<string, unknown> }>(code_url_or_refuse(`${ISLAND}?${copy}`));

const placed: Element[] = [];
function script(type: string, mark: string | null, text = ''): HTMLScriptElement {
	const el = document.createElement('script');
	el.type = type;
	if (mark !== null) el.setAttribute('data-og-mark', mark);
	el.textContent = text;
	placed.push(el);
	return el;
}
function page(mark: string | null, text?: string): void {
	const runtime = script('application/x-runtime-stand-in', MARK);
	runtime.setAttribute('data-ogygia-runtime', '');
	document.head.prepend(runtime);
	document.body.append(
		text === undefined
			? script('application/ogygia-env-served', mark)
			: script('application/ogygia-env', mark, text)
	);
}

let said: MockInstance<typeof console.warn>;
beforeEach(() => {
	said = vi.spyOn(console, 'warn').mockImplementation(() => {});
	init(link_boot());
	hold_code_for_env();
});
afterEach(() => {
	for (const el of placed.splice(0)) el.remove();
	vi.restoreAllMocks();
});

const downloads = new Downloads();
const env_requests = () => downloads.named('/kit-app/env.js').length;

test("a page's markup asks for nothing: only the server's own mark holds a region's code and asks for the env", async () => {
	page(null);
	expect((await load('markup')).env).toEqual({});
	await expect.poll(() => said.mock.calls.flat().join(' ')).toContain('kit_env_missing');
	expect(env_requests()).toBe(0);
});

test("the boot's link hands the router the served env's door where the app's Kit has an env module", async () => {
	const { L_ENV_SERVED_TO } = await import('../../src/runtime/boot-link-index.ts');
	expect(link_boot()[L_ENV_SERVED_TO]).toBe(env_served_to);
});

test('a page that carries its env loads no env module', async () => {
	page(MARK, stringify({ build: FIXTURE_BUILD, env: { PUBLIC_REGION: 'written' } }));
	expect((await load('written')).env).toEqual({ PUBLIC_REGION: 'written' });
	expect(env_requests()).toBe(0);
});

test("a prerendered page's region reads Kit's env module as its own module first runs", async () => {
	page(MARK);
	expect((await load('served')).env).toEqual({ PUBLIC_REGION: 'deployed' });
	expect(said.mock.calls.flat().join(' ')).not.toContain('kit_env_missing');
});

test('an env module that exports no env is a failed load, never an env', async () => {
	const { serve_kit_env } = await import('../../src/runtime/kit-env.ts');
	const at = { base: '', app_dir: '_app', assets: '' };
	for (const wrong of [null, {}, { env: null }, { env: 'eu' }])
		await expect(serve_kit_env(at, async () => wrong)).rejects.toThrow('exports no env');
	expect(kit_env(FIXTURE_BUILD)).toEqual({ PUBLIC_REGION: 'deployed' });
});

test("the boot, the reader and the router name the server's ask and the env module's origin alike", async () => {
	const { KIT_ENV_SERVED_TYPE } = await import('../../src/kit-env-served.ts');
	const { KIT_ENV_SERVED_SELECTOR } = await import('../../src/runtime/kit-env.ts');
	const { ENV_SERVED_TYPE } = await import('../../src/runtime/router-nav.ts');
	expect(KIT_ENV_SERVED_SELECTOR).toBe(`script[type="${KIT_ENV_SERVED_TYPE}"]`);
	expect(ENV_SERVED_TYPE).toBe(KIT_ENV_SERVED_TYPE);
});

test("a page that carries its own env reads that, after a prerendered page's was served", async () => {
	page(MARK, stringify({ build: FIXTURE_BUILD, env: { PUBLIC_REGION: 'written' } }));
	expect(kit_env(FIXTURE_BUILD)).toEqual({ PUBLIC_REGION: 'written' });
});

test("the env module's URL is the app's own, beside its assets, so a page moved to another folder finds it; with assets on another host, the app's base", () => {
	const at = { base: '/shop', app_dir: '_app', assets: '' };
	const page_origin = 'https://app.example.com';
	expect(
		kit_env_url(
			at,
			'https://app.example.com/moved/shop/_app/immutable/chunks/x.js?v=1',
			page_origin
		)
	).toBe('https://app.example.com/moved/shop/_app/env.js');
	expect(
		kit_env_url(
			{ ...at, assets: 'https://cdn.example.com/a' },
			'https://cdn.example.com/a/_app/immutable/chunks/x.js',
			page_origin
		)
	).toBe('https://app.example.com/shop/_app/env.js');
	expect(
		kit_env_url(at, 'https://elsewhere.example.com/_app/immutable/chunks/x.js', page_origin)
	).toBe('https://app.example.com/shop/_app/env.js');
});
