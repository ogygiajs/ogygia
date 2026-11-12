// The on-this-page outline and its scrollspy: the section being read is marked in the island's own
// list and in the page's static mobile outline (`.og-mtoc`, which has no spy of its own), and the
// spy lets go of the window when the outline goes.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from '$app/state';
import OnThisPage from '../../src/site/components/OnThisPage.svelte';
import type { Heading } from '../../src/site/types.ts';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

const headings: Heading[] = [
	{ depth: 2, id: 'otp-a', text: 'A' },
	{ depth: 2, id: 'otp-b', text: 'B' },
	{ depth: 2, id: 'otp-c', text: 'C' }
];

/** The page: each heading at `tops[i]` px from the document top, the document `height` px tall,
 *  and the static mobile outline the docs page renders beside the island. */
function lay_out(tops: number[], height: number): HTMLElement {
	const doc = document.createElement('div');
	doc.style.cssText = `position: relative; height: ${height}px;`;
	headings.forEach((h, i) => {
		const el = document.createElement('h2');
		el.id = h.id;
		el.textContent = h.text;
		el.style.cssText = `position: absolute; top: ${tops[i]}px; margin: 0;`;
		doc.append(el);
	});
	const mtoc = document.createElement('details');
	mtoc.className = 'og-mtoc';
	mtoc.innerHTML = `<ul class="og-toc-list">${headings.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join('')}</ul>`;
	document.body.append(mtoc, doc);
	return mtoc.querySelector('ul')!;
}

function outline(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	target.style.cssText = 'position: fixed; top: 0; right: 0;';
	document.body.append(target);
	const app = mount(OnThisPage, { target, props: { headings, title: 'Page', ...props } });
	flushSync();
	return { target, app };
}

const own_active = (target: HTMLElement) =>
	target.querySelector('.og-toc-link.og-active')?.textContent;
const static_active = (ul: HTMLElement) => ul.querySelector('a.og-active')?.textContent;

async function scroll_to(y: number) {
	window.scrollTo(0, y);
	window.dispatchEvent(new Event('scroll'));
	await frame();
	await frame();
	flushSync();
}

afterEach(() => {
	window.scrollTo(0, 0);
	document.body.style.margin = '';
	document.body.replaceChildren();
	page.url = new URL('http://localhost/');
});

describe('OnThisPage', () => {
	it("links the title to the page's own path, the same as on the server", async () => {
		page.url = new URL('http://localhost/docs/guide');
		const o = outline();
		expect(o.target.querySelector('.og-toc-title a')?.getAttribute('href')).toBe('/docs/guide');
		await unmount(o.app);
	});

	it('marks the last heading above the fold line, in its list and in the static outline', async () => {
		document.body.style.margin = '0';
		const ul = lay_out([1500, 3000, 4500], 9000);
		const o = outline();
		await scroll_to(3000 - 50);
		expect(own_active(o.target)).toBe('B');
		expect(static_active(ul)).toBe('B');
		expect(ul.classList.contains('og-has-active')).toBe(true);
		expect(ul.style.getPropertyValue('--og-thumb-y')).not.toBe('');
		await unmount(o.app);
	});

	it('marks the first heading on a short page where none crossed the fold line', async () => {
		document.body.style.margin = '0';
		const top = Math.round(innerHeight * 0.3);
		lay_out([top, top + 2000, top + 4000], 9000);
		const o = outline();
		await scroll_to(0);
		expect(own_active(o.target)).toBe('A');
		await unmount(o.app);
	});

	it('marks the last heading at the very bottom of the page', async () => {
		document.body.style.margin = '0';
		const height = 6000;
		lay_out([500, 1500, height - 200], height);
		const o = outline();
		await scroll_to(height);
		expect(own_active(o.target)).toBe('C');
		await unmount(o.app);
	});

	it('lets go of the window when it unmounts: a scroll after moves nothing', async () => {
		document.body.style.margin = '0';
		const ul = lay_out([1500, 3000, 4500], 9000);
		const o = outline();
		await scroll_to(1500 - 50);
		expect(static_active(ul)).toBe('A');
		await unmount(o.app);
		await scroll_to(4500 - 50);
		expect(static_active(ul)).toBe('A');
	});
});
