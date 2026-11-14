// The sidebar saves its scroll position as its panel scrolls, so the next page lands where the last
// one left off. The panel is the skin's (an ancestor, outside the component): when the sidebar goes,
// its saver must go with it, or the panel keeps writing positions for a sidebar that is gone (and a
// sidebar mounted again into the same panel adds a second saver).
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from '$app/state';
import Sidebar from '../../src/site/components/Sidebar.svelte';
import SidebarBaseHost from './fixtures/SidebarBaseHost.svelte';
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
	page.url = new URL('http://localhost/');
});

describe('the sidebar draws the nav tree', () => {
	const tree: NavTree = [
		{
			kind: 'group',
			label: 'Guide',
			items: [{ kind: 'leaf', slug: 'g/intro', href: '/d/g/intro', title: 'Intro' }]
		},
		{ kind: 'link', label: 'Source', href: 'https://example.com/x.y' },
		{ kind: 'leaf', slug: 'faq', href: '/d/faq', title: 'FAQ' }
	];

	/** Mounts the sidebar with `props` and waits until it has drawn its tree. */
	async function drawn(props: Record<string, unknown>) {
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(Sidebar, { target, props: { nav: tree, base: '/d', ...props } });
		flushSync();
		for (let i = 0; i < 10 && !target.querySelector('nav li'); i++) await frame();
		return { target, app };
	}

	it('nests a group, links a leaf, and passes a plain link through', async () => {
		const { target, app } = await drawn({});
		expect(target.querySelector('.og-nav-group .og-nav-label')?.textContent).toBe('Guide');
		expect(
			target.querySelector('.og-nav-group .og-nav-list a.og-nav-link')?.getAttribute('href')
		).toBe('/d/g/intro');
		expect(target.querySelector('a.og-nav-external')?.getAttribute('href')).toBe(
			'https://example.com/x.y'
		);
		void unmount(app);
	});

	it('draws each leaf with the item snippet when one is given', async () => {
		const item = createRawSnippet((leaf: () => { title: string }) => ({
			render: () => `<b data-own>${leaf().title}</b>`
		}));
		const { target, app } = await drawn({ item });
		expect([...target.querySelectorAll('[data-own]')].map((b) => b.textContent)).toEqual([
			'Intro',
			'FAQ'
		]);
		expect(target.querySelectorAll('a.og-nav-link:not(.og-nav-external)')).toHaveLength(0);
		void unmount(app);
	});

	it('gives every row its own view-transition name, a valid identifier', async () => {
		const { target, app } = await drawn({});
		const names = [...target.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')].map(
			(el) => el.style.viewTransitionName
		);
		expect(names).toHaveLength(4);
		expect(new Set(names).size).toBe(4);
		for (const n of names) expect(n).toMatch(/^[a-zA-Z_-][a-zA-Z0-9_-]*$/);
		void unmount(app);
	});
});

describe('the sidebar shows the active row', () => {
	it('centers the active row in the panel when it starts out of view', async () => {
		page.url = new URL(`http://localhost${BASE}/page-40`);
		const el = panel();
		const app = await mount_sidebar(el);
		const row = el.querySelector('[aria-current="page"]')!.getBoundingClientRect();
		const box = el.getBoundingClientRect();
		expect(el.scrollTop).toBeGreaterThan(0);
		expect(row.top).toBeGreaterThanOrEqual(box.top);
		expect(row.bottom).toBeLessThanOrEqual(box.bottom);
		await unmount(app);
	});

	it('moves only the panel, never the page', async () => {
		page.url = new URL(`http://localhost${BASE}/page-40`);
		const spacer = document.createElement('div');
		spacer.style.height = '3000px';
		document.body.append(spacer);
		const el = panel();
		const app = await mount_sidebar(el);
		expect(el.scrollTop).toBeGreaterThan(0);
		expect(window.scrollY).toBe(0);
		await unmount(app);
	});
});

describe('the sidebar keeps its scroll position', () => {
	it('saves the position while it is mounted', async () => {
		const el = panel();
		const app = await mount_sidebar(el);
		await scroll_to(el, 200);
		// (the position the engine reports: Firefox snaps a scroll to its device pixels, 200.35)
		expect(Number(sessionStorage.getItem(KEY))).toBeCloseTo(200, 0);
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

	it('a kept sidebar given a new base saves under the new base', async () => {
		const el = panel();
		const app = mount(SidebarBaseHost, { target: el, props: { nav, first: '/v1' } }) as {
			move: (base: string) => void;
		};
		flushSync();
		for (let i = 0; i < 10 && !el.querySelector('nav'); i++) await frame();
		await frame();
		app.move('/v2');
		flushSync();
		await scroll_to(el, 200);
		try {
			expect(sessionStorage.getItem('og:sidenav:/v1')).toBeNull();
			expect(Number(sessionStorage.getItem('og:sidenav:/v2'))).toBeCloseTo(200, 0);
		} finally {
			await unmount(app);
			sessionStorage.removeItem('og:sidenav:/v1');
			sessionStorage.removeItem('og:sidenav:/v2');
		}
	});
});
