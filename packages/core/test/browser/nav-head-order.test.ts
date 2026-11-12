// A NAVIGATED PAGE'S STYLESHEETS SIT IN THE ORDER A FRESH LOAD HAS THEM. Stylesheet order is the
// cascade's order: the app's global <style> (app.html) comes first and the page's own sheets after
// it, so a page rule wins a tie with a global rule. Found by the simulator (seed 24, #794): the
// router put every <style> and stylesheet <link> the next page carries at the TOP of <head>, above
// the app's globals, so the same page looked different reached by a click than by a load.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { runtime_session } from '../../src/runtime/session.ts';

const real_fetch = window.fetch;
const real_report = window.reportError;
const home = location.href;
const GLOBAL = '<style data-test-sheet="global">p{color:blue}</style>';
const SHEET = 'data:text/css,p%7Bcolor%3Agreen%7D';

/** Every page: app.html's global <style>, then the page's own <style> and stylesheet <link>, as Kit
 *  writes them after the template's head. */
function serve() {
	window.fetch = async (input: RequestInfo | URL) => {
		const path = new URL(String(input instanceof Request ? input.url : input), location.href)
			.pathname;
		return new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain">${GLOBAL}<style data-test-sheet="page ${path}">[data-page="${path}"]{color:red}</style><link rel="stylesheet" data-test-sheet="link ${path}" href="${SHEET}#${path}"></head><body><p data-page="${path}">${path}</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	};
}

/** The test's sheets in <head>, in order. */
const sheets = () =>
	[...document.head.querySelectorAll('[data-test-sheet]')].map((n) =>
		n.getAttribute('data-test-sheet')
	);

beforeEach(() => {
	link_boot();
	install_morph();
	document.head.insertAdjacentHTML('afterbegin', GLOBAL);
	runtime_session.adopt_document_head();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.reportError = () => {};
});
afterEach(() => {
	window.fetch = real_fetch;
	window.reportError = real_report;
	for (const n of document.head.querySelectorAll('[data-test-sheet]')) n.remove();
	history.replaceState(null, '', home);
});

test("the next page's own sheets land after the app's global <style>, as on a fresh load", async () => {
	serve();
	const r = new SpaRouter();
	const handed: string[] = [];
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.href);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	for (const path of ['/nav-order-a', '/nav-order-b']) {
		await r.navigate(new URL(path, location.href));
		await expect.poll(() => r.nav.now.kind, { timeout: 3_000 }).toBe('idle');
		expect(handed, path).toEqual([]);
		expect(sheets(), path).toEqual(['global', `page ${path}`, `link ${path}`]);
	}
});
