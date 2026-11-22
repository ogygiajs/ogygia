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
import theme_css from '../../src/site/theme.css?inline';

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

	it('names the whole sidebar inline, one name, so the router folds it on a shell change', async () => {
		const { target, app } = await drawn({});
		const named = [...target.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')];
		expect(named.map((el) => [el.tagName, el.style.viewTransitionName])).toEqual([
			['NAV', 'og-sidebar']
		]);
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

const THEMES: [string, string][] = [
	['theme.css', theme_css],
	...Object.entries(
		import.meta.glob<string>('../../src/site/themes/*.css', {
			query: '?inline',
			import: 'default',
			eager: true
		})
	).map(([file, css]): [string, string] => [`themes/${file.split('/').pop()}`, css])
];

const CHIP = 'og-nav-active';

/** The view-transition names the sidebar gives its own layers (the chip aside). */
function sidebar_layers(root: HTMLElement): string[] {
	const nav_el = root.querySelector<HTMLElement>('nav.og-sidebar')!;
	return [nav_el, ...nav_el.querySelectorAll<HTMLElement>('*')]
		.map((el) => getComputedStyle(el).viewTransitionName)
		.filter((n) => n && n !== 'none' && n !== CHIP);
}

/** A view-transition pseudo-element's computed style. */
function vt_style(pseudo: 'group' | 'old' | 'new', name: string): CSSStyleDeclaration {
	return getComputedStyle(document.documentElement, `::view-transition-${pseudo}(${name})`);
}

/** How much a snapshot shows: none when it is not displayed, else its opacity. */
function painted(pseudo: 'old' | 'new', name: string): number {
	const s = vt_style(pseudo, name);
	return s.display === 'none' ? 0 : Number(s.opacity);
}

/**
 * Navigates the sidebar from page 1 to page 2 inside a view transition styled by `css`, then holds
 * every transition animation at its midpoint and hands back the sidebar's target.
 */
async function hold_mid_navigation(css: string): Promise<{
	target: HTMLElement;
	finish: () => Promise<void>;
}> {
	const style = document.createElement('style');
	style.textContent = css;
	document.head.append(style);
	const target = document.createElement('div');
	document.body.append(target);
	page.url = new URL(`http://localhost${BASE}/page-1`);
	let app = await mount_sidebar(target);
	const t = document.startViewTransition(async () => {
		await unmount(app);
		page.url = new URL(`http://localhost${BASE}/page-2`);
		app = mount(Sidebar, { target, props: { nav, base: BASE } });
		flushSync();
		for (let i = 0; i < 50 && !target.querySelector('[aria-current="page"]'); i++)
			await new Promise((r) => setTimeout(r, 0));
	});
	await t.ready;
	for (const a of document.getAnimations()) {
		const end = Number(a.effect?.getComputedTiming().endTime ?? 0);
		a.pause();
		a.currentTime = end / 2;
	}
	return {
		target,
		finish: async () => {
			t.skipTransition();
			await t.finished.catch(() => undefined);
			await unmount(app);
			style.remove();
		}
	};
}

describe.runIf('startViewTransition' in document)('the sidebar in a view transition', () => {
	it.each(THEMES)(
		'%s: shows each sidebar label once mid-navigation, never its old and new snapshots stacked',
		async (_file, css) => {
			const { target, finish } = await hold_mid_navigation(css);
			try {
				// the chip's group animates, so the pseudo-element styles read here are live ones
				expect(vt_style('group', CHIP).animationName).not.toBe('none');
				const layers = sidebar_layers(target);
				expect(layers.length).toBeGreaterThan(0);
				const doubled = layers.filter((n) => painted('old', n) + painted('new', n) > 1.001);
				expect(doubled).toEqual([]);
			} finally {
				await finish();
			}
		}
	);

	it.each(THEMES)(
		'%s: paints the whole sidebar as one layer above the gliding chip, however many rows it has',
		async (_file, css) => {
			const { target, finish } = await hold_mid_navigation(css);
			try {
				const layers = sidebar_layers(target);
				expect(layers).toHaveLength(1);
				const chip_z = Number(vt_style('group', CHIP).zIndex);
				expect(Number(vt_style('group', layers[0]!).zIndex)).toBeGreaterThan(chip_z);
			} finally {
				await finish();
			}
		}
	);
});
