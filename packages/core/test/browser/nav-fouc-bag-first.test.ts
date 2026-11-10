// KIT'S FOUC BAG AT THE TOP OF THE HEAD, NAVIGATION AFTER NAVIGATION. Each next document carries
// Kit's `<style data-sveltekit>` (one per document, new CSS each time). The head merge puts a next
// document's `<style>` at the top of the head, above the head's first child before the merge, and
// takes the old bag out. After one navigation the bag it put in IS that first child: the next
// merge took it out and then put the new bag above a node no longer in the head, which threw
// inside the swap, so the navigation went to the browser as a full load.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';

const real_fetch = window.fetch;
const real_report = window.reportError;
const home = location.href;

/** Every page answers with its own FOUC bag, named after its path. */
function serve() {
	window.fetch = async (input: RequestInfo | URL) => {
		const path = new URL(String(input instanceof Request ? input.url : input), location.href)
			.pathname;
		return new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><style data-sveltekit>[data-page="${path}"]{color:red}</style><title>${path}</title></head><body><p data-page="${path}">${path}</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	};
}

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.reportError = () => {};
});
afterEach(() => {
	window.fetch = real_fetch;
	window.reportError = real_report;
	for (const bag of document.head.querySelectorAll('style[data-sveltekit]')) bag.remove();
	history.replaceState(null, '', home);
});

test('two navigations in a row, each bringing a FOUC bag: both go in, one bag is left', async () => {
	serve();
	const r = new SpaRouter();
	const handed: string[] = [];
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.href);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	for (const path of ['/nav-fouc-a', '/nav-fouc-b', '/nav-fouc-c']) {
		await r.navigate(new URL(path, location.href));
		await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
		expect(handed, path).toEqual([]);
		expect(document.body.querySelector('[data-page]')?.getAttribute('data-page'), path).toBe(path);
		const bags = document.head.querySelectorAll('style[data-sveltekit]');
		expect(bags.length, path).toBe(1);
		expect(bags[0].textContent, path).toContain(path);
	}
});
