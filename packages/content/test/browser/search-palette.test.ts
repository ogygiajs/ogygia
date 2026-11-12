// The search palette's query has an error path (#273). A query that rejects after the palette was
// ready (a worker that crashed later, a custom backend that is down) must show the error, take the
// previous term's results off the screen, and leave no unhandled rejection; a query that works
// again afterwards shows its results.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SearchPalette from '../../src/site/components/SearchPalette.svelte';
import type { SearchHit } from '../../src/site/search.ts';

// The worker client, recorded: what the palette builds it with, and whether it let it go. Set
// `load_error` to make its index fail to load.
const clients = vi.hoisted(() => [] as { opts: unknown; destroyed: boolean }[]);
const index = vi.hoisted(() => ({ load_error: null as Error | null }));
vi.mock('../../src/site/search-client.ts', () => ({
	SearchClient: class {
		ready = index.load_error ? Promise.reject(index.load_error) : Promise.resolve();
		#rec: { opts: unknown; destroyed: boolean };
		constructor(opts: unknown) {
			this.#rec = { opts, destroyed: false };
			clients.push(this.#rec);
		}
		async query(term: string) {
			return [hit(term)];
		}
		destroy() {
			this.#rec.destroyed = true;
		}
	}
}));

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

async function open_inline(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(SearchPalette, { target, props: { mode: 'inline', ...props } });
	flushSync();
	const input = await until(() => target.querySelector<HTMLInputElement>('input'));
	const type = (text: string) => {
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	};
	return { target, input, type, close: () => unmount(app) };
}

// Every option the listbox holds, as [text, aria-disabled].
function options(target: HTMLElement) {
	const list = target.querySelector('[role="listbox"]');
	return [...(list?.querySelectorAll('[role="option"]') ?? [])].map((o) => [
		o.textContent?.trim(),
		o.getAttribute('aria-disabled')
	]);
}

describe('the search palette', () => {
	it('starts its worker client when it mounts, with its base and limit, and stops it on unmount', async () => {
		clients.length = 0;
		const p = await open_inline({ base: '/docs', limit: 5 });
		expect(clients).toEqual([{ opts: { base: '/docs', limit: 5 }, destroyed: false }]);
		await p.close();
		expect(clients[0]?.destroyed).toBe(true);
	});

	it('shows the search as unavailable when its index does not load', async () => {
		index.load_error = new Error('index fetch failed');
		const p = await open_inline({});
		try {
			await sleep(50);
			flushSync();
			expect(p.target.querySelector('.og-search-error')?.textContent).toContain(
				'index fetch failed'
			);
			expect(options(p.target).map(([, disabled]) => disabled)).toEqual(['true']);
		} finally {
			index.load_error = null;
			await p.close();
		}
	});

	it('starts no worker client for a custom query backend', async () => {
		clients.length = 0;
		const p = await open_inline({ query: async () => [] });
		await sleep(50);
		expect(clients).toEqual([]);
		await p.close();
	});

	it('queries once for the last term typed in a quick burst', async () => {
		const asked: string[] = [];
		const p = await open_inline({
			query: async (t: string) => {
				asked.push(t);
				return [hit(t)];
			}
		});
		try {
			for (const t of ['a', 'al', 'alp', 'alph']) {
				p.type(t);
				await sleep(20);
			}
			await sleep(300);
			expect(asked).toEqual(['alph']);
		} finally {
			await p.close();
		}
	});

	it('does not query a term typed just before the field goes away', async () => {
		const asked: string[] = [];
		const p = await open_inline({
			query: async (t: string) => {
				asked.push(t);
				return [];
			}
		});
		p.type('alpha');
		await p.close();
		await sleep(300);
		expect(asked).toEqual([]);
	});

	it('does not show the failure of a term the visitor already typed past', async () => {
		const p = await open_inline({
			query: async (t: string) => {
				if (t === 'slow') {
					await sleep(400);
					throw new Error('slow term failed');
				}
				return [hit(t)];
			}
		});
		try {
			p.type('slow');
			await sleep(200); // its query is in flight
			p.type('fast');
			await sleep(600); // past both answers
			flushSync();
			expect(p.target.querySelector('.og-search-error')).toBeNull();
			expect(p.target.querySelector('.og-search-hit')?.textContent).toContain('fast');
		} finally {
			await p.close();
		}
	});

	it('keeps one disabled option in the listbox when there is nothing to show', async () => {
		const p = await open_inline({ query: async () => [] });
		try {
			const controls = document.getElementById(p.input.getAttribute('aria-controls') ?? '');
			expect(controls?.closest('[role="listbox"]')).toBeTruthy();
			expect(options(p.target)).toEqual([['Type to search the docs…', 'true']]);
			p.type('zzz');
			await sleep(300);
			flushSync();
			expect(options(p.target)).toEqual([['No results for “zzz”', 'true']]);
		} finally {
			await p.close();
		}
	});
});
