import { beforeEach, expect, inject, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';

const HYDRATION_WARNING_RE = /hydration_|discarded its ENTIRE/;

beforeEach(() => {
	document.body.innerHTML = '';
});

async function wake(region: Element, warns: string[]): Promise<void> {
	const real_warn = console.warn;
	console.warn = (...a: unknown[]) => warns.push(a.map(String).join(' '));
	try {
		await userEvent.click(region.querySelector('button')!);
		await expect.poll(() => region.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
	} finally {
		console.warn = real_warn;
	}
}

test('the server marks the {@html} range with content, and only that one', () => {
	const html = from_b64(inject('html_beside_ssr_b64'));
	expect(html).toContain('<div data-og-html="" class="beside">');
	expect(html.match(/<!--@html-->/g)).toEqual(['<!--@html-->']);
	expect(html).toMatch(/<!--@html--><em class="note">cms<\/em><!---->/);
});

test('an island with {@html} beside its template elements hydrates in DEV with no hydration warning', async () => {
	document.body.innerHTML = from_b64(inject('html_beside_ssr_b64'));
	const region = document.querySelector('ogygia-region')!;
	const warns: string[] = [];
	bootDev();
	await wake(region, warns);
	expect(region.hasAttribute('data-og-recovered'), 'NOT Svelte’s client re-render').toBe(false);
	expect(warns.filter((w) => HYDRATION_WARNING_RE.test(w))).toEqual([]);
	expect(region.innerHTML, 'the marks come out before Svelte hydrates').not.toContain('@html');
	const button = region.querySelector('button')!;
	await userEvent.click(button);
	await expect.poll(() => button.textContent).toMatch(/clicks [12]/);
});

test('a third party edits beside an {@html}: the template element is put back, the {@html} content is left alone', async () => {
	document.body.innerHTML = from_b64(inject('html_beside_ssr_b64'));
	const region = document.querySelector('ogygia-region')!;
	const warns: string[] = [];
	bootDev();
	const host = region.querySelector('.beside')!;
	host.querySelector('.walked')!.prepend(document.createElement('i'));
	host.querySelector('.after')!.before(document.createElement('u'));
	const note = host.querySelector('.note')!;
	note.append(document.createElement('s'));
	await wake(region, warns);
	expect(region.hasAttribute('data-og-healed'), 'hydrated from the server markup').toBe(true);
	expect(region.hasAttribute('data-og-recovered'), 'NOT Svelte’s client re-render').toBe(false);
	expect(warns.filter((w) => /hydration_(mismatch|discarded|html_changed)/.test(w))).toEqual([]);
	expect(host.querySelector('.walked > i'), 'the edit in the walked <p> is gone').toBeNull();
	expect(host.querySelector('u'), 'the element after the range is not {@html} content').toBeNull();
	expect(host.querySelector('.note'), 'the {@html} content kept its identity').toBe(note);
	expect(note.querySelector('s'), 'and the edit inside it').not.toBeNull();
});
