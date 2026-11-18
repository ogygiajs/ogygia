// DOM OWNERSHIP — a web component's own light DOM survives the island's wake.
//
// REGRESSION (a field report, 2026-10-06): an island server-renders a third-party search widget; the
// widget's definition loads before the island wakes, and on upgrade it prepends a backdrop and appends
// a suggestions pane to its own light DOM. The pre-hydration repair recursed into the widget and
// stripped both (search suggestions dead). Under the ownership model (runtime/ownership.ts) Svelte's
// hydration never walks a widget inside `{@html}` or a custom element with static children; the
// compiler stamps those hosts, and the repair, drift watch and morph leave them alone.
//
// Guards, for both shapes on one island:
//   (1) the server markup carries the compiler's stamp on both hosts;
//   (2) after the widget upgraded and the island woke: every widget node kept, same identity;
//   (3) the island hydrated (no recovery) and works.
// Usage: pnpm exec playwright test dom-ownership
import { test, check } from '@ogygia/tooling/e2e';

test.describe('DOM OWNERSHIP: a widget’s own nodes survive the wake', () => {
	test('SSR: both widget hosts carry the compiler’s opaque stamp', async ({ baseURL }) => {
		const html = await (await fetch(`${baseURL}/dom-ownership`)).text();
		check(
			'{@html} host stamped',
			/<div class="widget-host[^"]*"[^>]*data-og-opaque|<div data-og-opaque[^>]*class="widget-host/.test(
				html
			),
			html.slice(html.indexOf('widget-host') - 80, html.indexOf('widget-host') + 80)
		);
		check(
			'static custom element stamped',
			/<x-guided-e2e data-og-opaque[^>]*data-variant="static"|<x-guided-e2e[^>]*data-variant="static"[^>]*data-og-opaque/.test(
				html
			)
		);
		check(
			'{@html} beside walked content: parent stamped data-og-html',
			/<div data-og-html[^>]*class="widget-mixed|<div class="widget-mixed[^"]*"[^>]*data-og-html/.test(
				html
			)
		);
	});

	test('browser: the widget reworks its light DOM, the island wakes, every node stays', async ({
		page
	}) => {
		await page.goto('/dom-ownership', { waitUntil: 'load' });
		await page.waitForFunction(
			() => document.querySelectorAll('x-guided-e2e > .p').length === 3,
			null,
			{ timeout: 8000 }
		);
		// remember every widget child node, then wake the island
		await page.evaluate(() => {
			(window as unknown as { __kids: Element[][] }).__kids = Array.from(
				document.querySelectorAll('x-guided-e2e')
			).map((w) => Array.from(w.children));
		});
		check(
			'island still asleep before the click',
			(await page.locator('ogygia-region[data-hydrated]').count()) === 0
		);
		await page.locator('[data-wake]').click();
		await page.waitForSelector('ogygia-region[data-hydrated]', { timeout: 8000 });
		await page.locator('[data-wake]').click();
		await page.waitForTimeout(150);

		const same = await page.evaluate(() => {
			const before = (window as unknown as { __kids: Element[][] }).__kids;
			return Array.from(document.querySelectorAll('x-guided-e2e')).map((w, i) => {
				const now = Array.from(w.children);
				return {
					variant: w.getAttribute('data-variant'),
					classes: now.map((n) => n.className),
					identical: now.length === before[i].length && now.every((n, j) => n === before[i][j])
				};
			});
		});
		for (const w of same) {
			check(
				`${w.variant}: backdrop, form, icon, pane all present`,
				w.classes.join(',') === 'p,a,b,q',
				w.classes.join(',')
			);
			check(`${w.variant}: every node kept its identity`, w.identical);
		}
		check(
			'island hydrated without recovery',
			(await page.locator('ogygia-region[data-og-recovered]').count()) === 0
		);
		check(
			'island works after the wake',
			(await page.locator('[data-wake]').innerText()).includes('clicks 2')
		);
		check(
			'the walked sibling of the mixed widget stays live',
			(await page.locator('.widget-mixed h3').innerText()).includes('(2)')
		);
	});

	test('a third party edits the template element beside an {@html}: it is put back, the {@html} content is not (#1454)', async ({
		page
	}) => {
		const warns: string[] = [];
		page.on('console', (m) => {
			if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text());
		});
		await page.goto('/dom-ownership-beside', { waitUntil: 'load' });
		await page.waitForSelector('html[data-tp-done]', { timeout: 8000 });
		const region = page.locator('ogygia-region');
		check(
			'island still asleep before the click',
			(await region.getAttribute('data-hydrated')) === null
		);
		await page.locator('[data-beside-wake]').click();
		await page.waitForSelector('ogygia-region[data-hydrated]', { timeout: 8000 });
		check(
			'hydrated from the server markup, the walked <p> put back (data-og-healed)',
			(await region.getAttribute('data-og-healed')) !== null
		);
		check(
			'not Svelte’s client re-render (no data-og-recovered)',
			(await region.getAttribute('data-og-recovered')) === null
		);
		check(
			'the node put first in the walked <p> is gone',
			(await page.locator('.tp-walked').count()) === 0
		);
		check(
			'the node put after the {@html} content is gone: it is not {@html} content',
			(await page.locator('.tp-outside').count()) === 0
		);
		check(
			'the node put inside the {@html} content stays',
			(await page.locator('.note > .tp-content').count()) === 1
		);
		await page.locator('[data-beside-wake]').click();
		check(
			'the island works after the wake',
			(await page.locator('[data-beside-wake]').innerText()).includes('clicks 2'),
			await page.locator('[data-beside-wake]').innerText()
		);
		check(
			'no hydration warning',
			!warns.some((w) => /hydration_|discarded/.test(w)),
			warns.join('; ')
		);
	});
});
