// A PAGE WITH DECLARATIVE SHADOW DOM WORKS AFTER A ROUTER NAVIGATION (#1894). Each page has
// `<x-card>` hosts whose server render is a `<template shadowrootmode>`, one inside a
// `wake: 'load'` island. The router parses the next page DSD-aware, so every host on B has its
// shadow root, no template is left inert in the light DOM, and B's island hydrates against its
// server markup. A host the morph keeps across the navigation keeps its live shadow root (its
// element owns it); a host keyed to B is B's, with B's render.
//
// Against the built palaestra: /dsd, /dsd/b.
//   pnpm --filter palaestra e2e router-dsd
import type { Page } from '@playwright/test';
import { test, check } from '@ogygia/tooling/e2e';
import { page_errors } from '@ogygia/tooling/e2e/browsers.ts';

const DISCARDED_RE = /hydration_discarded/;

type Host = { light: string; shadow: string | null; badge_up: boolean };

async function hosts(page: Page, selector: string): Promise<Host[]> {
	return page.evaluate(
		(sel) =>
			Array.from(document.querySelectorAll(sel), (el) => ({
				light: el.textContent?.trim() ?? '',
				shadow: el.shadowRoot?.querySelector('x-badge')?.textContent ?? null,
				badge_up: el.shadowRoot?.querySelector('x-badge')?.hasAttribute('data-up') ?? false
			})),
		selector
	);
}

const island_hydrated = (page: Page) =>
	page.locator('ogygia-region[data-hydrated]:has([data-dsd-island])').waitFor();

test('a router navigation to a page with declarative shadow DOM: shadow roots live, the island hydrates', async ({
	page
}) => {
	const errors = page_errors(page);
	const discarded: string[] = [];
	page.on('console', (m) => {
		if (DISCARDED_RE.test(m.text())) discarded.push(m.text());
	});

	await page.goto('/dsd', { waitUntil: 'networkidle' });
	await island_hydrated(page);
	await page.evaluate(() => {
		(document.querySelector('[data-dsd-kept]') as Element & { __mark?: number }).__mark = 1;
	});

	await page.locator('[data-dsd-to-b]').click();
	await page.waitForURL('**/dsd/b');
	await page.locator('h1[data-dsd-heading]', { hasText: 'DSD B' }).waitFor();
	await island_hydrated(page);

	const inert = await page.evaluate(
		() => document.querySelectorAll('template[shadowrootmode]').length
	);
	check('no declarative shadow template is left inert in the light DOM', inert === 0, `${inert}`);

	const all = await hosts(page, 'x-card');
	check(
		'every <x-card> on B has a shadow root',
		all.length === 4 && all.every((h) => h.shadow !== null),
		JSON.stringify(all)
	);

	const [fresh] = await hosts(page, '[data-dsd-new]');
	check(
		'a host only B has shows B’s render, its nested element upgraded',
		fresh?.shadow === 'new B' && fresh.badge_up,
		JSON.stringify(fresh)
	);

	const [keyed] = await hosts(page, '[data-dsd-keyed]');
	check(
		'a host keyed to B is B’s, with B’s render',
		keyed?.shadow === 'keyed B',
		JSON.stringify(keyed)
	);

	const [island] = await hosts(page, '[data-dsd-island]');
	check(
		'the island’s host shows B’s render, its nested element upgraded',
		island?.shadow === 'island B' && island.badge_up,
		JSON.stringify(island)
	);
	await page.locator('[data-dsd-click]').click();
	const clicked = (await page.locator('[data-dsd-click]').textContent())?.trim();
	check('B’s island is live (a click counts)', clicked === 'clicked 1', clicked ?? '');

	const kept = await page.evaluate(() => {
		const el = document.querySelector('[data-dsd-kept]') as Element & { __mark?: number };
		return {
			same: el.__mark === 1,
			light: el.textContent?.trim() ?? '',
			shadow: el.shadowRoot?.querySelector('x-badge')?.textContent ?? null
		};
	});
	check(
		'a host kept across the navigation is the same element, its light DOM B’s',
		kept.same && kept.light === 'light B',
		JSON.stringify(kept)
	);
	check(
		'a kept host keeps its live shadow root (its element owns it)',
		kept.shadow === 'kept A',
		JSON.stringify(kept)
	);

	check('no island discarded its server markup', discarded.length === 0, discarded.join(' | '));
	check('no page errors', errors.length === 0, errors.join(' | '));
});
