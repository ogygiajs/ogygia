/**
 * The page seed keeps what serializes (server/page-seed.ts): a value devalue cannot carry (a
 * function, a symbol, a class no reducer knows) is left out where it sits, and only there. Islands'
 * props sidecars point into `page.data` by path, so one function deep in `data` must not take the
 * rest of `data` with it: every other path still resolves in the browser copy.
 */
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'devalue';
import { PageSeed } from '../src/server/page-seed.ts';

const page = (data: unknown, form: unknown = null, error: unknown = null) => ({
	url: { href: 'https://example.test/' },
	params: {},
	route: { id: '/' },
	status: 200,
	data,
	form,
	error
});

type Seed = { url: string; data: unknown; form: unknown; error: unknown };
const seed_of = (out: ReturnType<typeof PageSeed.serialize>): Seed => {
	expect(out).not.toBeNull();
	expect(out!.json).toBe(false);
	return parse(out!.text) as Seed;
};

/** What a props sidecar's reference reads in the browser copy. */
const at = (root: unknown, path: Array<string | number>): unknown =>
	path.reduce<unknown>((v, k) => (v as Record<string | number, unknown> | undefined)?.[k], root);

class Unknown {
	readonly v = 1;
}

describe('PageSeed.serialize keeps everything that serializes', () => {
	it('a function deep in data: only that leaf goes, the rest of data stays', () => {
		const blocks = Array.from({ length: 4 }, (_, i) => ({ id: i, title: `Block ${i}` }));
		const data = {
			site: { name: 'Site', format_price: (n: number) => `${n} USD` },
			page: { blocks }
		};
		const seed = seed_of(PageSeed.serialize(page(data)));
		expect(seed.url).toBe('https://example.test/');
		expect(seed.data).toEqual({ site: { name: 'Site' }, page: { blocks } });
		expect(at(seed.data, ['page', 'blocks', 2, 'title'])).toBe('Block 2');
		expect(Object.keys(at(seed.data, ['site']) as object)).toEqual(['name']);
	});

	it('a leaf in an array keeps its slot (undefined), so later indexes still point right', () => {
		const data = { list: [{ id: 0 }, () => 1, { id: 2 }, Symbol('s')] };
		const seed = seed_of(PageSeed.serialize(page(data)));
		const list = at(seed.data, ['list']) as unknown[];
		expect(list).toHaveLength(4);
		expect(list[1]).toBeUndefined();
		expect(list[3]).toBeUndefined();
		expect(at(seed.data, ['list', 2, 'id'])).toBe(2);
	});

	it('a sparse array keeps its holes', () => {
		const sparse: unknown[] = [];
		sparse[0] = 'a';
		sparse[3] = () => 1;
		sparse[5] = 'b';
		const seed = seed_of(PageSeed.serialize(page({ sparse })));
		const back = at(seed.data, ['sparse']) as unknown[];
		expect(back).toHaveLength(6);
		expect(1 in back).toBe(false);
		expect(3 in back).toBe(true);
		expect(back[5]).toBe('b');
	});

	it('a class no reducer knows goes; a value a reducer encodes stays', () => {
		class Money {
			readonly amount: number;
			constructor(amount: number) {
				this.amount = amount;
			}
		}
		const reducers = { Money: (v: unknown) => v instanceof Money && [v.amount] };
		const data = { price: new Money(5), odd: new Unknown(), when: new Date(7), n: 10n };
		const out = PageSeed.serialize(page(data), ((v: unknown) =>
			stringify(v, reducers)) as typeof stringify);
		expect(out).not.toBeNull();
		const seed = parse(out!.text, { Money: ([a]: [number]) => new Money(a) }) as Seed;
		expect(seed.data).toEqual({ price: new Money(5), when: new Date(7), n: 10n });
	});

	it('shared and cyclic objects keep their shape', () => {
		const shared = { id: 'shared' };
		const node: Record<string, unknown> = { name: 'root', a: shared, b: shared, fn: () => 1 };
		node.self = node;
		const seed = seed_of(PageSeed.serialize(page({ node })));
		const back = at(seed.data, ['node']) as Record<string, unknown>;
		expect(back.a).toBe(back.b);
		expect(back.self).toBe(back);
		expect('fn' in back).toBe(false);
	});

	it('inside a Map or a Set, only the entry that cannot go is left out', () => {
		const data = {
			m: new Map<unknown, unknown>([
				['keep', 1],
				['drop', () => 1],
				[() => 2, 'bad key']
			]),
			s: new Set<unknown>([1, () => 1, 'two'])
		};
		const seed = seed_of(PageSeed.serialize(page(data)));
		expect(at(seed.data, ['m'])).toEqual(new Map([['keep', 1]]));
		expect(at(seed.data, ['s'])).toEqual(new Set([1, 'two']));
	});

	it('form and error follow the same rule, and data is not touched by them', () => {
		const seed = seed_of(
			PageSeed.serialize(
				page({ ok: 1 }, { values: { q: 'x' }, submit: () => 1 }, { message: 'm', fn: () => 1 })
			)
		);
		expect(seed.data).toEqual({ ok: 1 });
		expect(seed.form).toEqual({ values: { q: 'x' } });
		expect(seed.error).toEqual({ message: 'm' });
	});

	it('a top-level value that cannot go reads as undefined, the seed still ships', () => {
		const seed = seed_of(PageSeed.serialize(page(() => 1)));
		expect(seed.data).toBeUndefined();
		expect(seed.url).toBe('https://example.test/');
	});

	it('the source objects are left as they were', () => {
		const fn = () => 1;
		const data = { site: { fn, name: 'Site' }, list: [fn] };
		PageSeed.serialize(page(data));
		expect(data.site.fn).toBe(fn);
		expect(data.list[0]).toBe(fn);
	});
});
