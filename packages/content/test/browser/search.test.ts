// The light half of search: a real link to the search page, and the keys that open the palette. The
// heavy half (the palette) loads on the first intent, except in a sheet (`mode: 'inline'`), where
// the sheet opening was the intent.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Search from '../../src/site/components/Search.svelte';
import type { SearchHit } from '../../src/site/search.ts';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => T | null | undefined): Promise<T> {
	for (let i = 0; i < 200; i++) {
		const value = read();
		if (value) return value;
		await frame();
	}
	throw new Error('never came');
}

const query = async (): Promise<SearchHit[]> => [];
const field = () => document.querySelector('input');

function search(mode: 'dialog' | 'inline' = 'dialog') {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(Search, { target, props: { base: '/docs', query, mode } });
	flushSync();
	return { target, app };
}

/** A keydown from `from` (the window by default), and whether search took it. */
function key(init: KeyboardEventInit, from: EventTarget = window): boolean {
	const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	from.dispatchEvent(e);
	return e.defaultPrevented;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('Search', () => {
	// (first in the file: the palette's download is once per page, so later tests find it loaded)
	it('renders a real link to the search page, and loads no palette before an intent', async () => {
		const s = search();
		expect(s.target.querySelector('a.og-search-trigger')?.getAttribute('href')).toBe(
			'/docs/search'
		);
		await sleep(300);
		const loaded = performance
			.getEntriesByType('resource')
			.some((r) => r.name.includes('SearchPalette.svelte'));
		expect(loaded).toBe(false);
		await unmount(s.app);
	});

	it('opens the palette on Ctrl+K', async () => {
		const s = search();
		expect(key({ key: 'k', ctrlKey: true })).toBe(true);
		await until(field);
		await unmount(s.app);
	});

	it('leaves a slash typed in a text field or an editor alone', async () => {
		const s = search();
		const input = document.createElement('input');
		const editor = document.createElement('div');
		editor.contentEditable = 'true';
		document.body.append(input, editor);
		expect(key({ key: '/' }, input)).toBe(false);
		expect(key({ key: '/' }, editor)).toBe(false);
		await sleep(300);
		flushSync();
		expect(document.querySelector('[role="dialog"]')).toBe(null);
		expect(key({ key: '/' }, document.body)).toBe(true);
		await unmount(s.app);
	});

	it('in a sheet, mounts the palette at once and leaves the keys to the page', async () => {
		const s = search('inline');
		await until(field);
		expect(key({ key: 'k', ctrlKey: true })).toBe(false);
		expect(key({ key: '/' }, document.body)).toBe(false);
		await unmount(s.app);
	});
});
