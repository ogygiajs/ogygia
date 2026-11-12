// The mobile bar's sheet switches views (nav, search) with its height gliding between them: it pins
// the old height, sets the new one, and lets go (back to `auto`) when the glide ends. When no glide
// runs (both views the same height, or a skin with no height transition) no `transitionend` comes:
// the switch must still let go, or the sheet keeps a fixed height its next content does not fit.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ShellBar from '../../src/site/components/ShellBar.svelte';
import type { NavTree } from '../../src/site/types.ts';

const nav: NavTree = [{ kind: 'leaf', slug: 'a', href: '/a', title: 'A' }];

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => T | null | undefined): Promise<T> {
	for (let i = 0; i < 100; i++) {
		const value = read();
		if (value) return value;
		await frame();
	}
	throw new Error('never came');
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('the mobile bar switches its sheet between views', () => {
	it('lets go of the pinned height when no glide runs', async () => {
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(ShellBar, { target, props: { nav } });
		flushSync();

		const menu = await until(() => target.querySelector<HTMLButtonElement>('.og-cbar-menu'));
		menu.click();
		const swap = await until(() => document.querySelector<HTMLElement>('.og-sheet-swap'));

		const search = await until(() =>
			target.querySelector<HTMLButtonElement>('[data-ph-sheet-toggle]:not(.og-cbar-menu)')
		);
		search.click();
		// the two frames of the switch, then well past any glide
		await frame();
		await frame();
		await frame();
		await sleep(400);

		expect(swap.style.height).toBe('');
		await unmount(app);
	});

	it('holds the height through a glide, then lets go when it ends', async () => {
		const style = document.createElement('style');
		style.textContent = '.og-sheet-swap { overflow: hidden; transition: height 200ms linear; }';
		document.head.append(style);
		try {
			const target = document.createElement('div');
			document.body.append(target);
			const app = mount(ShellBar, { target, props: { nav } });
			flushSync();
			const menu = await until(() => target.querySelector<HTMLButtonElement>('.og-cbar-menu'));
			menu.click();
			const swap = await until(() => document.querySelector<HTMLElement>('.og-sheet-swap'));
			// (the nav view is taller than the search one)
			const view = await until(() => swap.querySelector<HTMLElement>('.og-sheet-view'));
			view.style.minHeight = '300px';
			const search = await until(() =>
				target.querySelector<HTMLButtonElement>('[data-ph-sheet-toggle]:not(.og-cbar-menu)')
			);
			search.click();
			await frame();
			await frame();
			await frame();

			// mid-glide: the height is held
			expect(swap.style.height).toMatch(/px$/);
			await sleep(400);
			expect(swap.style.height).toBe('');
			await unmount(app);
		} finally {
			style.remove();
		}
	});

	it('switches between the nav and search views without closing the sheet', async () => {
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(ShellBar, { target, props: { nav } });
		flushSync();
		const menu = await until(() => target.querySelector<HTMLButtonElement>('.og-cbar-menu'));
		menu.click();
		const sheet = await until(() => document.querySelector<HTMLElement>('.og-sheet'));
		await until(() => sheet.querySelector('nav'));
		const search = await until(() =>
			target.querySelector<HTMLButtonElement>('[data-ph-sheet-toggle]:not(.og-cbar-menu)')
		);
		search.click();
		await until(() => sheet.querySelector('.og-cbar-search'));
		expect(sheet.isConnected).toBe(true);
		expect(document.querySelectorAll('.og-sheet')).toHaveLength(1);
		await unmount(app);
	});

	it('swaps at once under reduced motion: no height is pinned', async () => {
		const real = window.matchMedia;
		window.matchMedia = ((q: string) =>
			({
				...real.call(window, q),
				matches: q.includes('reduce')
			}) as MediaQueryList) as typeof real;
		try {
			const target = document.createElement('div');
			document.body.append(target);
			const app = mount(ShellBar, { target, props: { nav } });
			flushSync();
			const menu = await until(() => target.querySelector<HTMLButtonElement>('.og-cbar-menu'));
			menu.click();
			const swap = await until(() => document.querySelector<HTMLElement>('.og-sheet-swap'));
			const search = await until(() =>
				target.querySelector<HTMLButtonElement>('[data-ph-sheet-toggle]:not(.og-cbar-menu)')
			);
			search.click();
			await frame();
			expect(swap.style.height).toBe('');
			await frame();
			expect(swap.style.height).toBe('');
			await unmount(app);
		} finally {
			window.matchMedia = real;
		}
	});

	it('lets go of a switch in flight when it unmounts', async () => {
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(ShellBar, { target, props: { nav } });
		flushSync();
		const menu = await until(() => target.querySelector<HTMLButtonElement>('.og-cbar-menu'));
		menu.click();
		const swap = await until(() => document.querySelector<HTMLElement>('.og-sheet-swap'));
		const search = await until(() =>
			target.querySelector<HTMLButtonElement>('[data-ph-sheet-toggle]:not(.og-cbar-menu)')
		);
		search.click();
		// the switch has pinned the height and waits for its frames
		await until(() => (swap.style.height ? swap : null));
		await unmount(app);
		expect(swap.style.height).toBe('');
	});
});

// The sheet closes on a link that navigates this tab (#634); a click that opens elsewhere or goes
// nowhere (a modifier or middle click, a new-tab or download link, a handler that prevented it)
// leaves the visitor on this page, so the menu stays open.
describe('a link picked in the mobile sheet', () => {
	/** the sheet open over `links`, and whether a click (as `init`) on link `i` left it open */
	async function stays_open(i: number, init: MouseEventInit, prevent = false): Promise<boolean> {
		const target = document.createElement('div');
		document.body.append(target);
		const tree: NavTree = [
			{ kind: 'leaf', slug: 'a', href: '/a', title: 'A' },
			{ kind: 'leaf', slug: 'b', href: '/b', title: 'B' }
		];
		const app = mount(ShellBar, { target, props: { nav: tree } });
		flushSync();
		const menu = await until(() => target.querySelector<HTMLButtonElement>('.og-cbar-menu'));
		menu.click();
		const links = await until(() => {
			const all = document.querySelectorAll<HTMLAnchorElement>('.og-sheet-swap a[href]');
			return all.length ? all : null;
		});
		const link = links[i % links.length];
		if (i === 1) link.target = '_blank';
		if (i === 2) link.setAttribute('download', '');
		// (never navigate the test page)
		const stop = (e: Event) => e.preventDefault();
		if (prevent) link.addEventListener('click', stop);
		document.addEventListener('click', stop);
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
		document.removeEventListener('click', stop);
		flushSync();
		// (the menu button says whether the sheet is open; the sheet itself may still be fading out)
		const open = menu.getAttribute('aria-expanded') === 'true';
		await unmount(app);
		return open;
	}

	it('closes the sheet on a plain click', async () => {
		expect(await stays_open(0, {})).toBe(false);
	});

	it('keeps it open on a modifier or middle click, a new-tab or download link, or a prevented click', async () => {
		expect(await stays_open(0, { metaKey: true })).toBe(true);
		expect(await stays_open(0, { ctrlKey: true })).toBe(true);
		expect(await stays_open(0, { shiftKey: true })).toBe(true);
		expect(await stays_open(0, { button: 1 })).toBe(true);
		expect(await stays_open(1, {})).toBe(true);
		expect(await stays_open(2, {})).toBe(true);
		expect(await stays_open(0, {}, true)).toBe(true);
	});
});
