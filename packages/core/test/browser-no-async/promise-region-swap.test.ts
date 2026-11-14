import { expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PromiseRegion from '../../src/PromiseRegion.svelte';
import PromiseSwapHost from '../browser/fixtures/PromiseSwapHost.svelte';
import { og_html_region, type RegionValue } from '../../src/region.ts';

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

test('a promise region shows its placeholder until the first value lands, in the browser', async () => {
	const target = document.body.appendChild(document.createElement('div'));
	const first = Promise.withResolvers<RegionValue>();
	const app = mount(PromiseSwapHost, {
		target,
		props: { held: PromiseRegion, first: first.promise }
	});
	flushSync();
	expect(target.textContent).toBe('loading');
	first.resolve(og_html_region('<b>one</b>'));
	await settle();
	expect(target.textContent).toBe('one');
	await unmount(app);
	target.remove();
});

test('a new promise keeps the old value on screen until it lands, never the placeholder', async () => {
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(PromiseSwapHost, {
		target,
		props: { held: PromiseRegion, first: Promise.resolve(og_html_region('<b>one</b>')) }
	}) as { swap: (next: Promise<RegionValue>) => void };
	await settle();
	expect(target.textContent).toBe('one');
	const next = Promise.withResolvers<RegionValue>();
	app.swap(next.promise);
	flushSync();
	await settle();
	expect(target.textContent).toBe('one');
	next.resolve(og_html_region('<b>two</b>'));
	await settle();
	expect(target.textContent).toBe('two');
	await unmount(app);
	target.remove();
});

test('a promise replaced before it lands never shows: the newer one wins', async () => {
	const target = document.body.appendChild(document.createElement('div'));
	const old = Promise.withResolvers<RegionValue>();
	const app = mount(PromiseSwapHost, {
		target,
		props: { held: PromiseRegion, first: old.promise }
	}) as { swap: (next: Promise<RegionValue>) => void };
	flushSync();
	app.swap(Promise.resolve(og_html_region('<b>new</b>')));
	await settle();
	old.resolve(og_html_region('<b>old</b>'));
	await settle();
	expect(target.textContent).toBe('new');
	await unmount(app);
	target.remove();
});

test('a promise replaced before it rejects never fails the region: the newer one stays', async () => {
	const target = document.body.appendChild(document.createElement('div'));
	const old = Promise.withResolvers<RegionValue>();
	const app = mount(PromiseSwapHost, {
		target,
		props: { held: PromiseRegion, first: old.promise }
	}) as { swap: (next: Promise<RegionValue>) => void };
	flushSync();
	app.swap(Promise.resolve(og_html_region('<b>new</b>')));
	await settle();
	old.reject(new Error('late'));
	await settle();
	expect(target.textContent).toBe('new');
	await unmount(app);
	target.remove();
});
