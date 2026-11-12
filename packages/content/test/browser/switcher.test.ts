// The version / locale switcher: one menu per axis (or only the axes asked for), its options a
// single radio choice with the current one checked, and choosing one navigates to its href.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import Switcher from '../../src/site/components/Switcher.svelte';
import type { Switcher as SwitcherData } from '../../src/site/dimensions.ts';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

const switcher = [
	{
		axis: 'version',
		label: 'Version',
		current: 'v2',
		options: [
			{ value: 'v1', href: '/v1/intro' },
			{ value: 'v2', href: '/v2/intro' }
		]
	},
	{
		axis: 'locale',
		label: 'Language',
		current: 'en',
		options: [
			{ value: 'en', href: '/en/intro' },
			{ value: 'fr', href: '/fr/intro', missing: true }
		]
	}
] as unknown as SwitcherData;

function picker(props: { for?: string | string[] } = {}) {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(Switcher, { target, props: { switcher, ...props } });
	flushSync();
	const triggers = () => [...target.querySelectorAll<HTMLButtonElement>('.og-sw-trigger')];
	return { triggers, done: () => unmount(app) };
}

async function open(trigger: HTMLButtonElement) {
	await userEvent.click(trigger);
	await vi.waitFor(() => expect(document.querySelector('.og-sw-menu')).not.toBe(null));
	return [...document.querySelectorAll<HTMLElement>('.og-sw-menu [role="menuitemradio"]')];
}

afterEach(() => {
	goto.mockClear();
	document.body.replaceChildren();
});

describe('Switcher', () => {
	it('shows one menu per axis, with its current value', () => {
		const p = picker();
		expect(p.triggers().map((t) => [t.title, t.textContent?.trim()])).toEqual([
			['Version', 'v2'],
			['Language', 'en']
		]);
		p.done();
	});

	it('shows only the axes asked for', () => {
		const p = picker({ for: 'locale' });
		expect(p.triggers().map((t) => t.title)).toEqual(['Language']);
		p.done();
	});

	it('lists the options as one radio choice, the current one checked', async () => {
		const p = picker();
		const items = await open(p.triggers()[1]);
		expect(items.map((i) => [i.textContent?.trim(), i.getAttribute('aria-checked')])).toEqual([
			['en', 'true'],
			['fr', 'false']
		]);
		expect(items[1].classList.contains('og-missing')).toBe(true);
		p.done();
	});

	it('navigates to the chosen option', async () => {
		const p = picker();
		const items = await open(p.triggers()[0]);
		await userEvent.click(items[0]);
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/v1/intro'));
		p.done();
	});
});
