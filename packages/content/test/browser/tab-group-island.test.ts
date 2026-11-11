// The tab bar of a TabGroup: the island gets its panels as frozen server HTML, builds the bar from the
// panels' own labels, and keeps one choice per group across every block on the page (and across
// pages, in localStorage). The bar is built once: a selection moves its marker, never rebuilds it.
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TabGroupIsland from '../../src/site/components/TabGroupIsland.svelte';

const panels = (labels: string[]) =>
	createRawSnippet(() => ({
		render: () =>
			`<div>${labels.map((l) => `<div class="og-tabs-panel" role="tabpanel" data-label="${l}">${l} body</div>`).join('')}</div>`
	}));

let n = 0;
/** A group name no other test has used (the choice is one record per group, for the whole page). */
const fresh = () => `tgi-${Date.now()}-${n++}`;

function block(group: string, labels = ['npm', 'pnpm', 'yarn']) {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(TabGroupIsland, { target, props: { group, children: panels(labels) } });
	flushSync();
	const tabs = () => [...target.querySelectorAll<HTMLButtonElement>('.og-tabs-tab')];
	const selected = () =>
		tabs().find((b) => b.getAttribute('aria-selected') === 'true')?.textContent;
	const shown = () =>
		[...target.querySelectorAll<HTMLElement>('.og-tabs-panel')].find((p) => !p.hidden)?.dataset
			.label;
	return { target, app, tabs, selected, shown };
}

const press = (el: Element, key: string) =>
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

afterEach(() => {
	document.body.replaceChildren();
});

describe('TabGroupIsland', () => {
	it("builds the bar from the panels' own labels, above the panels", async () => {
		const b = block(fresh());
		expect(b.tabs().map((t) => t.textContent)).toEqual(['npm', 'pnpm', 'yarn']);
		const root = b.target.querySelector('.og-tabs')!;
		expect(root.firstElementChild?.classList.contains('og-tabs-bar')).toBe(true);
		expect(b.selected()).toBe('npm');
		expect(b.shown()).toBe('npm');
		await unmount(b.app);
	});

	it('moves focus with the arrows without selecting; a click selects', async () => {
		const b = block(fresh());
		b.tabs()[0].focus();
		press(b.tabs()[0], 'ArrowRight');
		expect(document.activeElement).toBe(b.tabs()[1]);
		expect(b.selected()).toBe('npm');
		expect(b.shown()).toBe('npm');
		b.tabs()[1].click();
		flushSync();
		expect(b.selected()).toBe('pnpm');
		expect(b.shown()).toBe('pnpm');
		await unmount(b.app);
	});

	it('keeps the same bar and marker across a selection', async () => {
		const b = block(fresh());
		const bar = b.target.querySelector('.og-tabs-bar');
		const marker = b.target.querySelector('.og-tabs-marker');
		b.tabs()[2].click();
		flushSync();
		expect(b.target.querySelectorAll('.og-tabs-bar')).toHaveLength(1);
		expect(b.target.querySelector('.og-tabs-bar')).toBe(bar);
		expect(b.target.querySelector('.og-tabs-marker')).toBe(marker);
		await unmount(b.app);
	});

	it('a choice in one block moves every block of the same group, and is saved', async () => {
		const group = fresh();
		const one = block(group);
		const two = block(group);
		const bar = two.target.querySelector('.og-tabs-bar');
		one.tabs()[1].click();
		flushSync();
		expect(two.selected()).toBe('pnpm');
		expect(two.shown()).toBe('pnpm');
		expect(two.target.querySelector('.og-tabs-bar')).toBe(bar);
		expect(localStorage.getItem(`og-tabs:${group}`)).toBe('pnpm');
		await unmount(one.app);
		await unmount(two.app);
	});

	it('starts on the choice saved by an earlier page', async () => {
		const group = fresh();
		localStorage.setItem(`og-tabs:${group}`, 'yarn');
		const b = block(group);
		expect(b.selected()).toBe('yarn');
		expect(b.shown()).toBe('yarn');
		await unmount(b.app);
		localStorage.removeItem(`og-tabs:${group}`);
	});
});
