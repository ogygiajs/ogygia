// The theme toggle cycles system → light → dark → system on the root's `data-theme` and keeps the
// choice in localStorage. With View Transitions it flips inside one, marking the root
// `data-ph-switching` until it ends; with reduced motion (or none) it flips at once.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ThemeToggle from '../../src/site/components/ThemeToggle.svelte';

const root = document.documentElement;
const theme = () => root.getAttribute('data-theme');

function toggle(props: { key?: string } = {}) {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(ThemeToggle, { target, props });
	flushSync();
	const button = target.querySelector<HTMLButtonElement>('.og-theme-toggle')!;
	return { button, done: () => unmount(app) };
}

/** View Transitions, for one test: each call runs its update at once and ends when `end` is called. */
function transitions() {
	let end: (ok: boolean) => void = () => {};
	const calls: number[] = [];
	Object.defineProperty(document, 'startViewTransition', {
		configurable: true,
		value: (update: () => void) => {
			calls.push(1);
			update();
			const finished = new Promise<void>((res, rej) => {
				end = (ok) => (ok ? res() : rej(new Error('skipped')));
			});
			return { finished };
		}
	});
	return { calls, end: (ok = true) => end(ok) };
}

/** No View Transitions in this browser, for one test. */
function no_transitions() {
	Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
}

function reduced_motion(on: boolean) {
	const real = window.matchMedia.bind(window);
	vi.spyOn(window, 'matchMedia').mockImplementation((q: string) =>
		q === '(prefers-reduced-motion: reduce)' ? ({ matches: on } as MediaQueryList) : real(q)
	);
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
	Reflect.deleteProperty(document, 'startViewTransition');
	vi.restoreAllMocks();
	root.removeAttribute('data-theme');
	root.removeAttribute('data-ph-switching');
	localStorage.clear();
	document.body.replaceChildren();
});

describe('ThemeToggle', () => {
	it('cycles system, light, dark, system and keeps the choice in localStorage', async () => {
		no_transitions();
		const t = toggle();
		expect(theme()).toBe(null);
		t.button.click();
		expect([theme(), localStorage.getItem('og-theme')]).toEqual(['light', 'light']);
		t.button.click();
		expect([theme(), localStorage.getItem('og-theme')]).toEqual(['dark', 'dark']);
		t.button.click();
		expect([theme(), localStorage.getItem('og-theme')]).toEqual([null, null]);
		await t.done();
	});

	it('keeps the choice under its own key', async () => {
		no_transitions();
		const t = toggle({ key: 'my-theme' });
		t.button.click();
		expect([localStorage.getItem('my-theme'), localStorage.getItem('og-theme')]).toEqual([
			'light',
			null
		]);
		await t.done();
	});

	it('still flips the theme when storage refuses', async () => {
		no_transitions();
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError');
		});
		const t = toggle();
		t.button.click();
		expect(theme()).toBe('light');
		await t.done();
	});

	it('flips inside a View Transition and marks the root until it ends', async () => {
		reduced_motion(false);
		const vt = transitions();
		const t = toggle();
		t.button.click();
		expect(vt.calls.length).toBe(1);
		expect(theme()).toBe('light');
		expect(root.hasAttribute('data-ph-switching')).toBe(true);
		vt.end();
		await settle();
		expect(root.hasAttribute('data-ph-switching')).toBe(false);
		t.button.click();
		vt.end(false);
		await settle();
		expect(root.hasAttribute('data-ph-switching')).toBe(false);
		await t.done();
	});

	it('flips at once, with no View Transition, under reduced motion', async () => {
		reduced_motion(true);
		const vt = transitions();
		const t = toggle();
		t.button.click();
		expect(vt.calls.length).toBe(0);
		expect(theme()).toBe('light');
		expect(root.hasAttribute('data-ph-switching')).toBe(false);
		await t.done();
	});
});
