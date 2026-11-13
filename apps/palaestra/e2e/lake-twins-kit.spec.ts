// TWO LAKES OF ONE COMPONENT KEEP THEIR OWN CONTENT WHEN KIT REMOUNTS THE PAGE (#1554). On a
// csr=true page a web component that edits its own light DOM before Kit hydrates makes Svelte's
// hydration mismatch: it clears Kit's root and mounts the document fresh, and every lake comes up
// empty and repaints from the runtime's copy of its server HTML. The copy was keyed by the lake's
// entry (component + schedule), so the header and the footer shared one: the footer repainted with
// the header's HTML and its own `wake: 'visible'` island was gone.
//
//   pnpm --filter palaestra e2e lake-twins-kit
import { test, check, sleep } from '@ogygia/tooling/e2e';

// Kit's entry, held back so the runtime boots first, as it does on a page of real size: on a tiny
// page Kit's start can win the race and remount before the runtime sees the lakes at all (#1561).
const KIT_ENTRY_RE = /\/_app\/immutable\/entry\/(start|app)\.[^/]+\.js$/;

test.describe('two same-component lakes on a csr=true page Kit remounts', () => {
	test('each lake keeps its own content after the remount, and the footer keeps its visible island', async ({
		page
	}) => {
		await page.route(KIT_ENTRY_RE, async (route) => {
			await sleep(400);
			await route.continue();
		});
		await page.addInitScript(() => {
			document.addEventListener('readystatechange', () => {
				if (document.readyState !== 'interactive') return;
				const main = document.querySelector('main') as (HTMLElement & { __ssr?: boolean }) | null;
				if (main) main.__ssr = true;
			});
		});
		await page.goto('/lake-twins-kit/', { waitUntil: 'networkidle' });
		await sleep(300);

		check(
			'Kit gave up hydrating and remounted the page (the case needs the remount)',
			await page.evaluate(
				() => !(document.querySelector('main') as HTMLElement & { __ssr?: boolean }).__ssr
			)
		);
		const kbtn = page.locator('[data-kit-btn]');
		await kbtn.click();
		check('Kit’s client is alive after the remount', (await kbtn.textContent())!.includes('kit:1'));

		const header = page.locator('ogygia-region[wake="none"]').nth(0);
		const footer = page.locator('ogygia-region[wake="none"]').nth(1);
		check(
			'two lakes on the page',
			(await page.locator('ogygia-region[wake="none"]').count()) === 2
		);
		check(
			'the header lake holds the header',
			(await header.locator('[data-twin-lake="header"]').count()) === 1 &&
				(await header.locator('[data-twin-lake="footer"]').count()) === 0
		);
		check(
			'the footer lake holds the footer, not a copy of the header',
			(await footer.locator('[data-twin-lake="footer"]').count()) === 1 &&
				(await footer.locator('[data-twin-lake="header"]').count()) === 0,
			(await footer.innerHTML()).slice(0, 300)
		);
		check(
			'each lake’s load island reports its own label',
			(await header.locator('[data-counter] strong').first().textContent()) === 'header load' &&
				(await footer.locator('[data-counter] strong').first().textContent()) === 'footer load'
		);

		const visible = footer.locator('ogygia-region[wake="visible"]');
		check('the footer’s visible island still exists', (await visible.count()) === 1);
		if ((await visible.count()) !== 1) return;
		await visible.scrollIntoViewIfNeeded();
		const vbtn = visible.locator('button');
		await vbtn.click();
		await page.waitForFunction(
			() =>
				document
					.querySelector('ogygia-region[wake="visible"] button')
					?.textContent?.includes('count is 1'),
			undefined,
			{ timeout: 5000 }
		);
		check('the footer’s visible island woke and answers', true);
	});
});
