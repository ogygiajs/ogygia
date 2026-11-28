// THE ROUTER AND A PRERENDERED PAGE'S ENV (KIT-PUBLIC-ENV, #2212): a region's module can run before
// the prerendered page that needs the served env is the open one (a prefetch warms it) or before its
// ask is in the document (a morph places the page's regions first), so the router asks for the env as
// it reads the fetched page, by that page's own mark.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Downloads } from '@ogygia/tooling/vitest/downloads';

(globalThis as { __OGYGIA_KIT_MAJOR__?: number }).__OGYGIA_KIT_MAJOR__ = 3;
const { hold_code_for_env } = await import('../../src/runtime/kit-env-first.ts');
const { import_file } = await import('../../src/runtime/import-again.ts');
const { code_url_or_refuse } = await import('../../src/runtime/code-origins.ts');
const { link_boot } = await import('../../src/runtime/boot-link.ts');
const { L_ENV_SERVED_TO } = await import('../../src/runtime/boot-link-index.ts');
const { SpaRouter } = await import('../../src/runtime/router.ts');
const { runtime_session } = await import('../../src/runtime/session.ts');
const nav = await import('../../src/runtime/router-nav.ts');

const ISLAND = '/test/browser/fixtures/reads-kit-env.ts';
const MARK = 'f'.repeat(24);
const FORGED = '0'.repeat(24);
const downloads = new Downloads();
const load = (copy: string) =>
	import_file<{ env: Record<string, unknown> }>(code_url_or_refuse(`${ISLAND}?${copy}`));

const real_fetch = window.fetch;
const home = location.href;
const next_page = (ask_mark: string, region = '') =>
	`<!doctype html><html><head><meta name="ogygia-router" content="plain"><script type="module" data-ogygia-runtime src="/_app/og-rt.js" data-og-mark="${MARK}"></script></head><body><p>next</p>${region}<script type="application/ogygia-env-served" data-og-mark="${ask_mark}"></script></body></html>`;
let served = '';

beforeEach(() => {
	nav.init(link_boot());
	hold_code_for_env();
	window.fetch = async () =>
		new Response(served, {
			headers: { 'content-type': 'text/html', 'cache-control': 'private, max-age=60' }
		});
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	for (const el of document.head.querySelectorAll('[data-ogygia-runtime]')) el.remove();
	vi.restoreAllMocks();
});

test('a prefetched page whose ask is not marked as its own asks for nothing', async () => {
	served = next_page(FORGED);
	await nav.fetch_page(new URL('/served-forged', location.href).href, undefined, 'prefetch');
	expect((await load('forged')).env).toEqual({});
	expect(downloads.named('/kit-app/env.js')).toEqual([]);
});

test('a prefetch of a prerendered page asks for the served env before the island it warms runs', async () => {
	served = next_page(
		MARK,
		`<ogygia-region wake="load" entry="${ISLAND}?prefetched-served"><p>next</p></ogygia-region>`
	);
	await nav.fetch_page(new URL('/served-next', location.href).href, undefined, 'prefetch');
	await downloads.loading('prefetched-served');
	expect((await load('prefetched-served')).env).toEqual({ PUBLIC_REGION: 'deployed' });
});

test('a navigation to a prerendered page asks for the served env before the page is swapped in', async () => {
	const boot = link_boot();
	const real = boot[L_ENV_SERVED_TO];
	const open_then: (string | null)[] = [];
	boot[L_ENV_SERVED_TO] = (doc) => {
		open_then.push(document.body.textContent);
		expect(doc.querySelector('script[type="application/ogygia-env-served"]')).not.toBeNull();
	};
	document.body.innerHTML = '<p>first</p>';
	runtime_session.adopt_document_head();
	served = next_page(MARK);
	try {
		const r = new SpaRouter();
		await r.navigate(new URL('/served-nav', location.href));
		await expect.poll(() => document.body.textContent).toContain('next');
		expect(open_then).toEqual(['first']);
	} finally {
		boot[L_ENV_SERVED_TO] = real;
	}
});
