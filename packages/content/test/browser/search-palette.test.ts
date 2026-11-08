// The search palette's query has an error path (#273). A query that rejects after the palette was
// ready (a worker that crashed later, a custom backend that is down) must show the error, take the
// previous term's results off the screen, and leave no unhandled rejection; a query that works
// again afterwards shows its results.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SearchPalette from '../../src/site/components/SearchPalette.svelte';
import type { SearchHit } from '../../src/site/search.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

async function until<T>(read: () => T | null | undefined): Promise<T> {
	for (let i = 0; i < 100; i++) {
		const value = read();
		if (value) return value;
		await frame();
	}
	throw new Error('never came');
}

const hit = (title: string): SearchHit => ({
	href: `/${title}`,
	slug: title,
	title,
	section: 'Docs',
	heading: '',
	excerpt: '',
	score: 1
});

afterEach(() => {
	document.body.replaceChildren();
});

describe('a search query that fails (#273)', () => {
	it('shows the error, drops the old results, and leaves no unhandled rejection', async () => {
		const unhandled: unknown[] = [];
		const on_unhandled = (e: PromiseRejectionEvent) => {
			unhandled.push(e.reason);
			e.preventDefault();
		};
		window.addEventListener('unhandledrejection', on_unhandled);
		let down = false;
		const query = async (term: string): Promise<SearchHit[]> => {
			if (down) throw new Error('search engine crashed');
			return [hit(term)];
		};
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(SearchPalette, { target, props: { query, mode: 'inline', open: true } });
		flushSync();
		try {
			const input = await until(() => target.querySelector<HTMLInputElement>('input'));
			const type = async (text: string) => {
				input.value = text;
				input.dispatchEvent(new Event('input', { bubbles: true }));
				await sleep(300); // past the field's debounce, and the query's answer
				flushSync();
			};

			await type('alpha');
			expect(target.querySelector('.og-search-hit')?.textContent).toContain('alpha');

			down = true;
			await type('beta');
			expect(target.querySelector('.og-search-error')?.textContent).toContain(
				'search engine crashed'
			);
			expect(target.querySelector('.og-search-hit')).toBeNull();
			await sleep(50);
			expect(unhandled).toEqual([]);

			// the backend back: the next query shows its results, and the error goes
			down = false;
			await type('gamma');
			expect(target.querySelector('.og-search-hit')?.textContent).toContain('gamma');
			expect(target.querySelector('.og-search-error')).toBeNull();
		} finally {
			window.removeEventListener('unhandledrejection', on_unhandled);
			await unmount(app);
		}
	});
});
