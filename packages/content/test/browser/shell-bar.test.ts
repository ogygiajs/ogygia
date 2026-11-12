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
