// The sidebar saves its scroll position as its panel scrolls, so the next page lands where the last
// one left off. The panel is the skin's (an ancestor, outside the component): when the sidebar goes,
// its saver must go with it, or the panel keeps writing positions for a sidebar that is gone (and a
// sidebar mounted again into the same panel adds a second saver).
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Sidebar from '../../src/site/components/Sidebar.svelte';
import type { NavTree } from '../../src/site/types.ts';

const BASE = '/docs-sidebar-test';
const KEY = `og:sidenav:${BASE}`;

const nav: NavTree = Array.from({ length: 60 }, (_, i) => ({
	kind: 'leaf' as const,
	slug: `page-${i}`,
	href: `${BASE}/page-${i}`,
	title: `Page ${i}`
}));

/** A scrolling panel, as a docs skin wraps its sidebar in. */
function panel(): HTMLElement {
	const el = document.createElement('div');
	el.style.cssText = 'height: 120px; overflow-y: auto;';
	document.body.append(el);
	return el;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

/** Scrolls `el` to `top` and waits for its scroll event. */
async function scroll_to(el: HTMLElement, top: number): Promise<void> {
	const scrolled = new Promise((r) => el.addEventListener('scroll', r, { once: true }));
	el.scrollTop = top;
	await scrolled;
}

/** Mounts the sidebar into `target` and waits until it has found its panel. */
async function mount_sidebar(target: HTMLElement): Promise<ReturnType<typeof mount>> {
	const app = mount(Sidebar, { target, props: { nav, base: BASE } });
	flushSync();
	for (let i = 0; i < 10 && !target.querySelector('nav'); i++) await frame();
	await frame();
	return app;
}

afterEach(() => {
	sessionStorage.removeItem(KEY);
	document.body.replaceChildren();
});

describe('the sidebar keeps its scroll position', () => {
	it('saves the position while it is mounted', async () => {
		const el = panel();
		const app = await mount_sidebar(el);
		await scroll_to(el, 200);
		expect(sessionStorage.getItem(KEY)).toBe('200');
		await unmount(app);
	});

	it('lets go of the panel when it unmounts: scrolling the panel after saves nothing', async () => {
		const el = panel();
		const app = await mount_sidebar(el);
		await unmount(app);
		// the panel stays (it is the skin's), with content of its own that still scrolls
		const filler = document.createElement('div');
		filler.style.height = '2000px';
		el.append(filler);
		sessionStorage.removeItem(KEY);

		await scroll_to(el, 300);

		expect(sessionStorage.getItem(KEY)).toBeNull();
	});
});
