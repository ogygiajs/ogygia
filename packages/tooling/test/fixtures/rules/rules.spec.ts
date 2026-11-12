// Run by test/e2e-check.test.ts through Playwright: the `page` fixture's rules check on three pages.
import { test } from '../../../src/e2e/index.ts';

test('ogygia booted, built without its rules', async ({ page }) => {
	await page.setContent('<script>window.__ogygia = { v: "0.0.0" };</script>');
});

test('ogygia booted with its rules, none broken', async ({ page }) => {
	await page.setContent(
		'<script>window.__ogygia = { v: "0.0.0" }; window.__ogygia_rules = () => [];</script>'
	);
});

test('a page that is not ogygia’s', async ({ page }) => {
	await page.setContent('<p>plain</p>');
});
