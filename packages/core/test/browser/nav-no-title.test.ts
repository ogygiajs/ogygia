// A PAGE WITH NO <title> HAS NONE AFTER A CLIENT NAVIGATION, as on a fresh load of it. Found by the
// simulator (seed 4): the router set `document.title = doc.title`, and setting `document.title`
// makes a <title> when the document has none, so the page gained an empty one.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { runtime_session } from '../../src/runtime/session.ts';

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
			`<!doctype html><html><head><meta name="ogygia-router" content="plain">${title}</head><body><p data-page="${path}">${path}</p></body></html>`,
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

test('back to a titled page from one with no <title>: exactly one <title>, as on a fresh load (seed 443)', async () => {
	serve();
	const r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation(() => {
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	const titles = () => [...document.querySelectorAll('title')].map((t) => t.textContent);
	const settle = async (path: string) => {
		await expect
			.poll(() => document.body.querySelector('[data-page]')?.getAttribute('data-page'), {
				timeout: 2_000
			})
			.toBe(path);
		await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
	};
	await r.navigate(new URL('/titled-back-a', location.href));
	await settle('/titled-back-a');
	await r.navigate(new URL('/no-title-back-b', location.href));
	await settle('/no-title-back-b');
	expect(titles()).toEqual([]);
	await r.navigate(new URL('/titled-back-a', location.href), { push: false, type: 'popstate' });
	await settle('/titled-back-a');
	expect(titles()).toEqual(['/titled-back-a']);
	expect(document.title).toBe('/titled-back-a');
});

test('back to a freshly loaded titled page from one with no <title>: exactly one <title>', async () => {
	serve();
	// the first page as a fresh load has it: its own <title> in the head the server sent
	history.replaceState(history.state, '', '/titled-start');
	const own = document.createElement('title');
	own.textContent = '/titled-start';
	document.head.append(own);
	runtime_session.adopt_document_head(); // (the boot's: what the server sent is the page's)
	prepare_spa_document();
	const r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation(() => {
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	const titles = () => [...document.querySelectorAll('title')].map((t) => t.textContent);
	const settle = async (path: string) => {
		await expect
			.poll(() => document.body.querySelector('[data-page]')?.getAttribute('data-page'), {
				timeout: 2_000
			})
			.toBe(path);
		await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
	};
	await r.navigate(new URL('/no-title-fresh-b', location.href));
	await settle('/no-title-fresh-b');
	expect(titles()).toEqual([]);
	await r.navigate(new URL('/titled-start', location.href), { push: false, type: 'popstate' });
	await settle('/titled-start');
	expect(titles()).toEqual(['/titled-start']);
});
