/**
 * CANARY (#1714, #1718, #1719): how SvelteKit starts its client, asked of a real Kit app
 * (kit-app.ts) for every Kit the workspace installs, in dev and in a build of each bundle strategy.
 * The start gate (src/server/kit-gate.ts) rewrites the first `import("…")` of Kit's inline start
 * script so Kit starts after ogygia's runtime; `is_kit_boot_script` (src/runtime/kit-boot.ts) knows
 * the script by its `__sveltekit_*` global; and the Kit page thread (kit-page-thread.svelte.ts) waits
 * for `page.status` to leave -1, which it reads in an effect.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import { kit_gate, kit_start_ungated } from '../../src/server/kit-gate.ts';
import { kit_boot_script } from '../../src/server/html-scan.ts';
import { is_kit_boot_script } from '../../src/runtime/kit-boot.ts';
import { KitApp, SLOW_RUNTIME, type KitAppOptions, type KitMode } from './kit-app.ts';
import { broke, KITS, type Internal } from './upstream.ts';

const START: Internal = {
	upstream: 'SvelteKit\'s inline start script (the `import("…")` of its client entry)',
	used_by: [
		'packages/core/src/server/kit-gate.ts',
		'packages/core/src/hooks.ts (the csr=true path)'
	],
	issue: 1714
};
const GLOBAL: Internal = {
	upstream: "SvelteKit's `__sveltekit_*` global (assigned in its start script)",
	used_by: [
		'packages/core/src/runtime/kit-boot.ts (is_kit_boot_script)',
		'packages/core/src/server/html-scan.ts'
	],
	issue: 1718
};
const PAGE: Internal = {
	upstream:
		"SvelteKit's client `page` state (`page.status` is -1 until Kit applies the first page)",
	used_by: ['packages/core/src/runtime/kit-page-thread.svelte.ts'],
	issue: 1719
};

const end_of = (html: string) => html.lastIndexOf('</body>');
const gated = (html: string) => kit_gate(html, end_of(html))?.html ?? html;
const with_runtime = (html: string) => html.replace('</head>', `${SLOW_RUNTIME}</head>`);

const SERVED: ReadonlyArray<[string, KitMode, KitAppOptions]> = [
	['dev', 'dev', {}],
	['a build, split bundle', 'build', { bundle: 'split' }],
	['a build, single bundle', 'build', { bundle: 'single' }]
];

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

describe.each(Object.entries(KITS))('%s', (_, root) => {
	let browser: Browser;
	beforeAll(async () => {
		browser = await KitApp.browser();
	});
	afterAll(async () => {
		await browser.close();
	});

	describe.each(SERVED)('served from %s', (_, mode, options) => {
		const app = new KitApp(root, mode, options);
		let html = '';
		beforeAll(async () => {
			await app.start();
			html = await app.text('/');
		});
		afterAll(() => app.stop());

		it('the gate finds the import in its start script, and Kit starts after a slow runtime', async () => {
			expect(
				kit_gate(html, end_of(html)),
				broke(START, `the gate finds no \`import("…")\` in the page Kit sent:\n${html}`)
			).not.toBeNull();
			expect(kit_start_ungated(html, end_of(html))).toBe(false);
			const start = await app.start_in(browser, '/', (h) => with_runtime(gated(h)));
			expect(start.init_ran, broke(START, 'Kit did not start behind the gate')).toBe(true);
			expect(
				start.runtime_before_init,
				broke(START, "Kit started before the page's deferred module script ran")
			).toBe(true);
		});

		it('assigns its `__sveltekit_*` global in the start script', () => {
			const script = kit_boot_script(html, end_of(html));
			const name = mode === 'dev' ? /__sveltekit_dev\s*=/ : /__sveltekit_[a-z0-9]+\s*=/;
			expect(
				script?.text,
				broke(GLOBAL, `the start script does not assign ${name.source}:\n${html}`)
			).toMatch(name);
			expect(
				is_kit_boot_script('', () => false, script!.text),
				broke(GLOBAL, 'is_kit_boot_script does not know the start script by its global')
			).toBe(true);
		});

		it('its client page has status -1 until Kit applies the first page, which an effect sees', async () => {
			const start = await app.start_in(browser, '/');
			expect(start.status_at_init, broke(PAGE, '`page.status` is not -1 in `init`')).toBe(-1);
			expect(
				start.status_seen,
				broke(PAGE, 'an effect on `page.status` did not see -1 and then 200')
			).toEqual([-1, 200]);
		});
	});

	describe('served from a build, inline bundle', () => {
		const app = new KitApp(root, 'build', { bundle: 'inline' });
		beforeAll(() => app.start());
		afterAll(() => app.stop());

		it('imports nothing, so the gate says it ungated and dev warns', async () => {
			const html = await app.text('/');
			expect(kit_start_ungated(html, end_of(html))).toBe(true);
		});
	});
});
