// A PAGE WITH NO <title> HAS NONE AFTER A CLIENT NAVIGATION, as on a fresh load of it. Found by the
// simulator (seed 4): the router set `document.title = doc.title`, and setting `document.title`
// makes a <title> when the document has none, so the page gained an empty one.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';

const real_fetch = window.fetch;
const real_report = window.reportError;
const home = location.href;
const home_titles: Element[] = [];

/** `/titled-*` pages carry a <title> named after their path; every other page has none. */
function serve() {
	window.fetch = async (input: RequestInfo | URL) => {
		const path = new URL(String(input instanceof Request ? input.url : input), location.href)
			.pathname;
		const title = path.startsWith('/titled-') ? `<title>${path}</title>` : '';
		return new Response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain">' +
				`${title}</head><body><p data-page="${path}">${path}</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	};
}

beforeEach(() => {
	link_boot();
	install_morph();
	for (const t of document.querySelectorAll('title')) {
		home_titles.push(t);
		t.remove();
	}
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.reportError = () => {};
});
afterEach(() => {
	window.fetch = real_fetch;
	window.reportError = real_report;
	for (const t of document.querySelectorAll('title')) t.remove();
	document.head.append(...home_titles.splice(0));
	history.replaceState(null, '', home);
});

test('a page with no <title> keeps none after client navigations to it, and a titled page gets its own', async () => {
	serve();
	const r = new SpaRouter();
	const handed: string[] = [];
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.href);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	const visits: [string, string[]][] = [
		['/no-title-a', []],
		['/titled-b', ['/titled-b']],
		['/no-title-c', []],
		['/titled-d', ['/titled-d']]
	];
	for (const [path, titles] of visits) {
		await r.navigate(new URL(path, location.href));
		await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
		expect(handed, path).toEqual([]);
		expect(document.body.querySelector('[data-page]')?.getAttribute('data-page'), path).toBe(path);
		expect(
			[...document.querySelectorAll('title')].map((t) => t.textContent),
			path
		).toEqual(titles);
	}
});
