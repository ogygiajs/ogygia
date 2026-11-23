// The seed's ONE walk (seed-index.ts: the request memo measures the page seed first and records each
// node's place in the same pass; props measured after it say which nodes may reach the seed; clones
// match by interned structure ids) against the walks it replaced (test/_oracle/seed-walk-v0.ts:
// measure every island's props, then index page.data in a second walk, then plan every island's
// props top-down with a string hash). Over generated pages — shared nodes across islands and the
// seed, clones with keys in another order, Dates, Maps, Sets, bigints, -0 and NaN, empty slots,
// symbol-branded and class values, big strings, cycles — and whichever islands were measured before
// the page was known: every node's measure, the index (size, every path, every byte bucket in
// order, the touched keys), and every island's plan (count, keys, the reference of every props
// node) and wire text are the old walks', byte for byte.
import { afterEach, describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { analysis, MeasureMemo, set_measure_memo_reader } from '../src/seed-refs.ts';
import { same_structure, SeedIndex, StructureHashes } from '../src/seed-index.ts';
import { walk_page_seed } from '../src/server/document-seeds.ts';
import { PropsWire, stringify_props } from '../src/server/props-wire.ts';
import { escape_script_text } from '../src/escape.ts';
import {
	bytes_of,
	hash_subtree,
	is_plain,
	measure as old_measure,
	OldSeedIndex,
	unpack as old_unpack
} from './_oracle/seed-walk-v0.ts';

type Rng = () => number;

function rng_of(seed: number): Rng {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

class Opaque {
	readonly n: number;
	constructor(n: number) {
		this.n = n;
	}
}

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ';
const KEYS = ['id', 'title', 'body', 'rows', 'meta', 'links', 'a', 'b', 'x y', 'é', '0', '10'];

interface Knobs {
	share: number;
	cycles: boolean;
	rich: boolean;
	islands: number;
	before: number;
}

/** A page: its data and its islands' props, built from one seed with the knobs' mix. */
function page_of(seed: number, k: Knobs) {
	const r = rng_of(seed);
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
	const pool: object[] = [];
	const leaf = (seed_side: boolean): unknown => {
		const n = r();
		if (n < 0.3)
			return `${pick(['', 'a', 'é<', ' ', 'x"y'])}${LOREM.slice(0, Math.floor(r() * 60))}`;
		if (n < 0.4) return LOREM.repeat(1 + Math.floor(r() * 4));
		if (n < 0.55) return Math.floor(r() * 1000) / (r() < 0.5 ? 1 : 7);
		if (n < 0.6) return r() < 0.5;
		if (n < 0.63) return null;
		if (!k.rich) return 'plain';
		if (n < 0.66) return undefined;
		if (n < 0.69) return pick([-0, NaN, Infinity, -Infinity, 0]);
		if (n < 0.72) return BigInt(Math.floor(r() * 1e6));
		if (n < 0.76) return new Date(r() < 0.9 ? Math.floor(r() * 2e12) : NaN);
		if (seed_side && n < 0.78) return new Opaque(Math.floor(r() * 9));
		return 'leaf';
	};
	const node = (depth: number, seed_side: boolean): unknown => {
		if (pool.length > 0 && r() < k.share) return pick(pool);
		if (depth <= 0 || r() < 0.2) return leaf(seed_side);
		const n = r();
		let out: object;
		if (k.rich && n < 0.06) {
			const m = new Map<unknown, unknown>();
			for (let i = 0; i < 3; i++) m.set(leaf(seed_side), node(depth - 1, seed_side));
			out = m;
		} else if (k.rich && n < 0.1) {
			out = new Set([leaf(seed_side), node(depth - 1, seed_side)]);
		} else if (k.rich && seed_side && n < 0.13) {
			out = { [Symbol.for('ogygia.brand')]: true, v: node(depth - 1, seed_side) };
		} else if (n < 0.45) {
			const a: unknown[] = [];
			const len = Math.floor(r() * 7);
			for (let i = 0; i < len; i++) a.push(node(depth - 1, seed_side));
			out = k.rich && len > 1 && r() < 0.1 ? holed(a, Math.floor(r() * len)) : a;
		} else {
			const o: Record<string, unknown> = {};
			const len = Math.floor(r() * 6);
			for (let i = 0; i < len; i++) o[pick(KEYS)] = node(depth - 1, seed_side);
			out = o;
		}
		pool.push(out);
		return out;
	};
	const blocks: unknown[] = [];
	for (let i = 0; i < 3 + Math.floor(r() * 6); i++) blocks.push(node(4, true));
	const data: Record<string, unknown> = {
		catalog: { title: LOREM, blocks },
		extra: node(3, true),
		greeting: 'hello'
	};
	const seed_nodes = plain_nodes(data);
	if (k.cycles && seed_nodes.length > 2)
		for (let i = 0; i < 2; i++) {
			const at = pick(seed_nodes) as Record<string, unknown>;
			if (!Array.isArray(at)) at[`cyc${i}`] = pick(seed_nodes);
		}
	const clone = (v: unknown, flip: boolean, seen = new Map<object, unknown>()): unknown => {
		if (v instanceof Date) return new Date(v.getTime());
		if (!is_plain(v)) return v;
		if (seen.has(v)) return seen.get(v);
		if (Array.isArray(v)) {
			const a: unknown[] = [];
			a.length = v.length;
			seen.set(v, a);
			for (let i = 0; i < v.length; i++) if (i in v) a[i] = clone(v[i], flip, seen);
			return a;
		}
		const o: Record<string, unknown> = {};
		seen.set(v, o);
		const keys = Object.keys(v);
		if (flip) keys.reverse();
		for (const key of keys) o[key] = clone((v as Record<string, unknown>)[key], flip, seen);
		return o;
	};
	const serializable = seed_nodes.filter((n) => !holds_unsendable(n));
	const islands: Record<string, unknown>[] = [];
	for (let i = 0; i < k.islands; i++) {
		const props: Record<string, unknown> = {};
		for (let j = 0; j < 1 + Math.floor(r() * 3); j++) {
			const n = r();
			const from = serializable.length ? pick(serializable) : null;
			if (from && n < 0.4) props[`p${j}`] = from;
			else if (from && n < 0.65) props[`p${j}`] = clone(from, r() < 0.3);
			else if (from && n < 0.75) props[`p${j}`] = { wrap: from, note: LOREM };
			else {
				const fresh = node(3, false);
				props[`p${j}`] = holds_unsendable(fresh) ? LOREM : fresh;
			}
		}
		if (k.cycles && r() < 0.2) props.self = props;
		islands.push(props);
	}
	return { data, islands };
}

/** `a` with an empty slot at `at`. */
function holed(a: unknown[], at: number): unknown[] {
	const out: unknown[] = [];
	out.length = a.length;
	for (let i = 0; i < a.length; i++) if (i !== at && i in a) out[i] = a[i];
	return out;
}

/** Holds a value no props wire carries (a class no codec claims, a symbol-branded object). */
function holds_unsendable(v: unknown, seen = new Set<object>()): boolean {
	if (v === null || typeof v !== 'object') return false;
	if (seen.has(v)) return false;
	seen.add(v);
	if (v instanceof Opaque) return true;
	if (v instanceof Map) {
		for (const [a, b] of v) if (holds_unsendable(a, seen) || holds_unsendable(b, seen)) return true;
		return false;
	}
	if (v instanceof Set) {
		for (const a of v) if (holds_unsendable(a, seen)) return true;
		return false;
	}
	if (!Array.isArray(v) && Object.getOwnPropertySymbols(v).length > 0) return true;
	for (const c of Object.values(v)) if (holds_unsendable(c, seen)) return true;
	return false;
}

/** Every plain object and array reachable from `v` (through Maps and Sets too), each once. */
function plain_nodes(v: unknown, out: object[] = [], seen = new Set<object>()): object[] {
	if (v === null || typeof v !== 'object' || seen.has(v)) return out;
	seen.add(v);
	if (v instanceof Map)
		for (const [a, b] of v) {
			plain_nodes(a, out, seen);
			plain_nodes(b, out, seen);
		}
	else if (v instanceof Set) for (const a of v) plain_nodes(a, out, seen);
	else if (is_plain(v)) {
		out.push(v);
		for (const c of Object.values(v)) plain_nodes(c, out, seen);
	}
	return out;
}

/** The old walks: the first `before` islands' props, the seed's measure, the other islands' props,
 *  then the index (its second walk of the seed), then each plan. The old handle measured every
 *  island first (`before` = all); measuring the seed where the new walk does is the same order. */
function old_run(data: unknown, islands: Record<string, unknown>[], before: number) {
	const memo = new Map<object, number>();
	islands.slice(0, before).forEach((props) => old_measure(props, memo));
	old_measure(data, memo);
	islands.slice(before).forEach((props) => old_measure(props, memo));
	const index = new OldSeedIndex(data, memo);
	const plans = islands.map((props) => index.plan(props, memo));
	return { memo, index, plans };
}

/** The one walk: `before` islands measured ahead of the page (a hole, document()), then the seed,
 *  then the rest, through the request memo the handle installs. */
function new_run(data: unknown, islands: Record<string, unknown>[], before: number) {
	const memo = new MeasureMemo();
	set_measure_memo_reader(() => memo);
	const wires: PropsWire[] = [];
	const wire = (props: Record<string, unknown>) => {
		analysis(props);
		wires.push(new PropsWire(props, 'e'));
	};
	islands.slice(0, before).forEach(wire);
	walk_page_seed(data, memo);
	islands.slice(before).forEach(wire);
	const index = SeedIndex.of(data, memo);
	const plans = islands.map((props) => index.plan(props));
	const texts = wires.map((w) => w.wire(index));
	set_measure_memo_reader(null);
	return { memo, index, plans, texts };
}

function old_text(
	props: Record<string, unknown>,
	plan: { count: number; matched: Map<object, unknown> }
) {
	if (plan.count > 0)
		return {
			text: stringify_props(props, 'e', (v) =>
				v === null || typeof v !== 'object' ? undefined : plan.matched.get(v)
			),
			json: false
		};
	const m = old_measure(props, new Map());
	if (old_unpack(m).json) return { text: escape_script_text(JSON.stringify(props)), json: true };
	return { text: stringify_props(props, 'e', null, new Set()), json: false };
}

/**
 * The one walk against the old walks run in the same order, and on a page without a cycle (where
 * the order cannot change a measure) against the old order too: every island measured before the
 * seed. With a cycle that an island's props share with the seed, the old walks' index depended on
 * which island rendered first (a cycle cut where the island entered it could estimate a seed node
 * under the threshold and hide its subtree from the index); the seed is now measured first.
 */
function same_page(seed: number, k: Knobs): void {
	const { data, islands } = page_of(seed, k);
	const before = Math.min(k.before, islands.length);
	const now = new_run(data, islands, before);
	compare(data, islands, now, old_run(data, islands, before));
	if (!k.cycles) compare(data, islands, now, old_run(data, islands, islands.length));
}

function compare(
	data: unknown,
	islands: Record<string, unknown>[],
	now: ReturnType<typeof new_run>,
	old: ReturnType<typeof old_run>
): void {
	const nodes = plain_nodes({ data, islands });
	for (const n of nodes) {
		const o = old.memo.get(n);
		const p = now.memo.nodes.get(n);
		if (o === undefined || p === undefined) {
			expect(p === undefined).toBe(o === undefined);
			continue;
		}
		expect({ ...old_unpack(o) }).toEqual(analysis_unpack(p));
	}
	expect(now.index.size).toBe(old.index.size);
	for (const n of plain_nodes(data)) {
		expect(now.index.path(n)).toEqual(old.index.path(n));
		expect(now.index.has(n)).toBe(old.index.path(n) !== undefined);
	}
	const buckets = new Set(old.index.nodes.map((n) => bytes_of(old.memo.get(n)!)));
	for (const b of buckets) expect(now.index.candidates(b)).toEqual(old.index.candidates(b));
	islands.forEach((props, i) => {
		const o = old.plans[i]!;
		const p = now.plans[i]!;
		expect(p.count).toBe(o.count);
		expect([...p.keys].sort()).toEqual([...o.keys].sort());
		for (const n of plain_nodes(props)) expect(p.reducer(n)).toEqual(o.matched.get(n));
		expect(now.texts[i]).toEqual(old_text(props, o));
	});
	expect([...now.index.touched].sort()).toEqual([...old.index.touched].sort());
}

function analysis_unpack(p: number) {
	const m = old_unpack(0);
	m.bytes = (p - (p & 15)) / 16;
	m.ref = (p & 1) !== 0;
	m.json = (p & 2) !== 0;
	m.thenable = (p & 4) !== 0;
	return m;
}

const KNOBS = fc.record({
	share: fc.constantFrom(0, 0.1, 0.3),
	cycles: fc.boolean(),
	rich: fc.boolean(),
	islands: fc.integer({ min: 1, max: 8 }),
	before: fc.integer({ min: 0, max: 3 })
});

describe('the seed walk · one walk against the old walks', () => {
	afterEach(() => set_measure_memo_reader(null));

	it("every island's plan and wire text match the old walks, over generated pages", () => {
		fc.assert(
			fc.property(fc.integer(), KNOBS, (seed, k) => same_page(seed, k)),
			{ numRuns: 600 }
		);
	}, 30_000);

	it('the CMS shape: blocks by identity, clones with keys reordered, a header the seed does not hold', () => {
		for (let seed = 1; seed <= 50; seed++)
			same_page(seed, { share: 0, cycles: false, rich: false, islands: 8, before: seed % 3 });
	});

	it('a clone matches the seed node with its own keys, not an earlier one holding the same values under other keys', () => {
		const s1 = 'a'.repeat(60);
		const s2 = 'b'.repeat(60);
		const data = {
			list: [
				{ x: s1, y: s2 },
				{ p: s1, q: s2 }
			]
		};
		const props = { block: { p: s1, q: s2 } };
		const now = new_run(data, [props], 0);
		const old = old_run(data, [props], 1);
		expect(now.plans[0]!.reducer(props.block)).toEqual(['list', 1]);
		compare(data, [props], now, old);
	});

	it('a clone matches the seed node of its own date, not an earlier one of the same size', () => {
		const pad = 'p'.repeat(100);
		const data = {
			list: [
				{ at: new Date(1), pad },
				{ at: new Date(2), pad }
			]
		};
		const props = { block: { at: new Date(2), pad } };
		const now = new_run(data, [props], 0);
		expect(now.plans[0]!.reducer(props.block)).toEqual(['list', 1]);
		compare(data, [props], now, old_run(data, [props], 1));
	});

	it('a structure class is the old one: a number by its text (0 and -0 alike), a missing key unlike an undefined one', () => {
		const pad = 'p'.repeat(100);
		const pages = [
			{
				list: [
					{ n: -0, pad },
					{ n: 0, pad }
				],
				props: { block: { n: 0, pad } }
			},
			{
				list: [
					{ n: 0, pad },
					{ n: -0, pad }
				],
				props: { block: { n: -0, pad } }
			},
			{
				list: [
					{ at: new Date(NaN), pad },
					{ at: new Date(NaN), pad }
				],
				props: { block: { at: new Date(NaN), pad } }
			},
			{
				list: [
					{ a: undefined, pad },
					{ b: undefined, pad }
				],
				props: { block: { b: undefined, pad } }
			},
			{
				list: [[undefined, pad], holed([0, pad], 0)],
				props: { block: holed([0, pad], 0) }
			}
		];
		for (const { list, props } of pages) {
			const data = { list };
			compare(data, [props], new_run(data, [props], 0), old_run(data, [props], 1));
		}
	});

	it("a plan against a second seed on the same memo does not trust the first seed's reach", () => {
		const memo = new MeasureMemo();
		set_measure_memo_reader(() => memo);
		SeedIndex.of({ a: { body: 'a'.repeat(200) } }, memo);
		const props = { p: { body: 'b'.repeat(300) } };
		analysis(props);
		const second = SeedIndex.of({ b: { body: 'b'.repeat(300) } }, memo);
		expect(second.plan(props).reducer(props.p)).toEqual(['b']);
	});
});

/** A copy of `v` with one change at a generated spot: a leaf replaced, a key renamed, removed or
 *  added as `undefined`, an element turned into an empty slot, a 0 into -0 — or none. */
function perturbed(v: unknown, r: Rng): unknown {
	const nodes = plain_nodes(v);
	const target = nodes.length && r() < 0.8 ? nodes[Math.floor(r() * nodes.length)] : null;
	const how = Math.floor(r() * 6);
	const copy = (x: unknown, seen = new Map<object, unknown>()): unknown => {
		if (!is_plain(x)) return x;
		if (seen.has(x)) return seen.get(x);
		if (Array.isArray(x)) {
			const a: unknown[] = [];
			a.length = x.length;
			seen.set(x, a);
			for (let i = 0; i < x.length; i++) if (i in x) a[i] = copy(x[i], seen);
			if (x === target && a.length) {
				const i = Math.floor(r() * a.length);
				if (how < 2) return holed(a, i);
				if (how < 4) a[i] = a[i] === 0 ? -0 : 'changed';
				else a[i] = undefined;
			}
			return a;
		}
		const o: Record<string, unknown> = {};
		seen.set(x, o);
		const keys = Object.keys(x).reverse();
		for (const key of keys) o[key] = copy((x as Record<string, unknown>)[key], seen);
		if (x === target) {
			const key = keys[Math.floor(r() * keys.length)];
			if (how === 0 && key !== undefined) delete o[key];
			else if (how === 1 && key !== undefined) {
				o[`${key}_`] = o[key];
				delete o[key];
			} else if (how === 2) o.added = undefined;
			else if (key !== undefined)
				o[key] = o[key] === 0 ? -0 : o[key] === undefined ? null : 'changed';
		}
		return o;
	};
	return copy(v);
}

describe('the seed walk · structure classes', () => {
	it("same_structure is the old hash's equality, over generated values and their near copies", () => {
		fc.assert(
			fc.property(fc.integer(), KNOBS, (seed, k) => {
				const { data } = page_of(seed, { ...k, cycles: false });
				const r = rng_of(seed ^ 0x5bd1e995);
				for (const a of plain_nodes(data).slice(0, 12)) {
					if (old_measure(a, new Map()) % 2 === 0) continue;
					const b = perturbed(a, r);
					const h = (x: unknown) => hash_subtree(x, new Map(), new Set())?.hash ?? null;
					const hashes = new StructureHashes();
					expect(same_structure(a, b)).toBe(h(a) === h(b));
					if (same_structure(a, b)) expect(hashes.of(a)).toBe(hashes.of(b));
				}
			}),
			{ numRuns: 400 }
		);
	});
});

/** A page.data of arbitrary values (fast-check's `anything`: odd keys, null prototypes, Maps,
 *  Sets, Dates, bigints, empty slots), islands handed its subtrees, copies of them and arbitrary
 *  values of their own. */
const ANY = fc.anything({
	maxDepth: 4,
	maxKeys: 6,
	withMap: true,
	withSet: true,
	withDate: true,
	withBigInt: true,
	withNullPrototype: true,
	withSparseArray: true
});

function sendable_text(props: Record<string, unknown>, reducer: ((v: unknown) => unknown) | null) {
	try {
		return stringify_props(props, 'e', reducer);
	} catch (e) {
		return `throws ${(e as Error).message}`;
	}
}

describe('the seed walk · fuzz', () => {
	afterEach(() => set_measure_memo_reader(null));

	it('arbitrary page data and props: the index, the plans and the referenced texts are the old walks', () => {
		fc.assert(
			fc.property(
				fc.array(ANY, { minLength: 1, maxLength: 6 }),
				fc.array(fc.tuple(fc.nat(), fc.nat(3), ANY), { minLength: 1, maxLength: 6 }),
				fc.nat(3),
				(parts, asks, before) => {
					const data: Record<string, unknown> = { big: 'x'.repeat(120), parts };
					const nodes = plain_nodes(data);
					const islands = asks.map(([at, how, own]) => {
						const from = nodes[at % nodes.length]!;
						if (how === 0) return { from };
						if (how === 1) return { from: structuredClone(from) };
						if (how === 2) return { from: { wrap: from, pad: 'y'.repeat(100) } };
						return { own };
					});
					const before_n = Math.min(before, islands.length);
					const memo = new MeasureMemo();
					set_measure_memo_reader(() => memo);
					islands.slice(0, before_n).forEach((p) => analysis(p));
					walk_page_seed(data, memo);
					islands.slice(before_n).forEach((p) => analysis(p));
					const index = SeedIndex.of(data, memo);
					const plans = islands.map((p) => index.plan(p));
					set_measure_memo_reader(null);
					const old = old_run(data, islands, islands.length);
					expect(index.size).toBe(old.index.size);
					for (const n of nodes) expect(index.path(n)).toEqual(old.index.path(n));
					islands.forEach((props, i) => {
						const o = old.plans[i]!;
						expect(plans[i]!.count).toBe(o.count);
						for (const n of plain_nodes(props))
							expect(plans[i]!.reducer(n)).toEqual(o.matched.get(n));
						expect(sendable_text(props, plans[i]!.reducer)).toBe(
							sendable_text(props, (v) =>
								v === null || typeof v !== 'object' ? undefined : o.matched.get(v)
							)
						);
					});
				}
			),
			{ numRuns: 1500 }
		);
	});
});
