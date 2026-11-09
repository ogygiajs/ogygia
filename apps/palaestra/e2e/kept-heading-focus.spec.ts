// A HEADING THE NAVIGATION FOCUSED GIVES BACK ITS TABINDEX (#278). A navigation to `#hash` focuses
// its target, made focusable for the moment with `tabindex="-1"`, and puts the attribute back as it
// was once focus leaves. The heading here is inside an island the navigations keep (the same island,
// same props, on /hole-kept/a and /hole-kept/b), so no morph puts its attributes back.
// Two navigations that focus it before it loses focus (a refresh in place, at the exact address) each
// saved what they found: the second one saw the first one's `-1` as the heading's own, and put it
// back after the first one took it away. The heading stayed in the tab order for good.
//
//   pnpm --filter palaestra e2e kept-heading-focus
import { test, expect, check } from '@ogygia/tooling/e2e';
import type { Page } from '@playwright/test';

/** Click a fresh link to `href` from script, so focus stays where it is (and no earlier click of
 *  that link is joined), and wait for the navigation to finish (focus is reset by then). */
function navigate_in_page(page: Page, href: string) {
	return page.evaluate(
		(href) =>
			new Promise<void>((resolve) => {
				document.addEventListener('og:page-load', () => resolve(), { once: true });
				const a = document.createElement('a');
				a.href = href;
				a.textContent = 'go';
				document.body.appendChild(a);
				a.click();
				a.remove();
			}),
		href
	);
}

test('a heading focused by two navigations in a row gives its tabindex back when focus leaves', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/hole-kept/a');
	await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
	await page.waitForFunction(
		() => typeof (history.state as { ogygia?: string } | null)?.ogygia === 'string'
	);
	const heading = page.locator('#kept-heading');
	// the island is awake: a click counts
	await page.locator('[data-kept-heading-button]').click();
	await expect(page.locator('[data-kept-heading-button]')).toHaveText('clicked 1');
	const focused = () => page.evaluate(() => document.activeElement?.id ?? '');
	const kept = async () =>
		(await page.locator('[data-kept-heading-button]').textContent()) === 'clicked 1';

	// to the heading on b: the navigation focuses it
	await navigate_in_page(page, '/hole-kept/b#kept-heading');
	await expect(page.locator('[data-hole-kept-page="b"]')).toHaveCount(1);
	check('the island was kept', await kept());
	check('the navigation focused the heading', (await focused()) === 'kept-heading');
	// the same address again, focus still on the heading: a refresh in place focuses it again
	await navigate_in_page(page, '/hole-kept/b#kept-heading');
	check('the island was kept again', await kept());
	check('the heading is still focused', (await focused()) === 'kept-heading');

	// focus leaves the heading
	await page.locator('[data-hole-kept-link]').focus();
	check('focus left the heading', (await focused()) !== 'kept-heading');
	const tabindex = await heading.getAttribute('tabindex');
	check('the heading has no tabindex left', tabindex === null, String(tabindex));
	check('no page errors', errors.length === 0, errors.join(' | '));
});
