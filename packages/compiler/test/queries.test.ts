// QUERIES (src/compiler/queries.ts): an answer is computed again only when what it read changed, an
// answer that comes out the same stops there, and after any run of edits every answer equals the
// one a fresh database on the final inputs gives. The last is checked on Kit's route answers
// (kit.ts), over random route trees and random edits told to the reader the way the dev watcher
// tells it.
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { dedent } from '@ogygia/core/contract';
import { derived, input, queries, same } from '../src/compiler/queries.ts';
import { memory_fs, type MemoryFs } from '../src/compiler/fs.ts';
import {
	clientBuildWillSkip,
	csrTrueRouteIds,
	errorCsrTrueRouteIds,
	hasAnyCsrFalseRoute,
	hasAnyCsrTrueRoute,
	page_route_config,
	rootLayoutCsrTrue,
	routeCsrIsFalse,
	routeCsrIsTrue,
	route_reader,
	type Routes
} from '../src/compiler/kit.ts';

/** A tiny world: named cells the test sets, and counters of how often each answer ran. */
function world() {
	const cells = new Map<string, number>();
	const runs = new Map<string, number>();
	const ran = (name: string) => runs.set(name, (runs.get(name) ?? 0) + 1);
	const cell = input(
		'cell',
		(k: string) => k,
		(k: string) => cells.get(k) ?? 0
	);
	const parity = derived(
		'parity',
		(k: string) => k,
		(cx, k: string) => {
			ran(`parity ${k}`);
			return cx.get(cell, k) % 2;
		}
	);
	const label = derived(
		'label',
		(k: string) => k,
		(cx, k: string) => {
			ran(`label ${k}`);
			return cx.get(parity, k) === 0 ? 'even' : 'odd';
		}
	);
	return { cells, runs, cell, parity, label };
}

describe('queries', () => {
	test('an answer is computed once, and again only after what it read changed', () => {
		const w = world();
		const db = queries('test');
		expect(db.get(w.label, 'a')).toBe('even');
		expect(db.get(w.label, 'a')).toBe('even');
		expect(w.runs.get('label a')).toBe(1);
		db.set(w.cell, 'b', 1); // another cell: nothing that `a` read
		expect(db.get(w.label, 'a')).toBe('even');
		expect(w.runs.get('parity a')).toBe(1);
		db.set(w.cell, 'a', 3);
		expect(db.get(w.label, 'a')).toBe('odd');
		expect(w.runs.get('label a')).toBe(2);
	});

	test('an answer that comes out the same stops there: its readers keep theirs', () => {
		const w = world();
		const db = queries('test');
		db.set(w.cell, 'a', 1);
		expect(db.get(w.label, 'a')).toBe('odd');
		db.set(w.cell, 'a', 5); // parity still 1
		expect(db.get(w.label, 'a')).toBe('odd');
		expect(w.runs.get('parity a')).toBe(2);
		expect(w.runs.get('label a')).toBe(1);
	});

	test('an answer, not an input, cannot be set', () => {
		const w = world();
		const db = queries('test');
		expect(() => db.set(w.parity as never, 'a', 1)).toThrow(/query parity is not an input/);
	});

	test('an answer that now throws has moved, for a watcher and for answers_changed_since', () => {
		const cells = new Map<string, number>();
		const cell = input(
			'cell',
			(k: string) => k,
			(k: string) => cells.get(k) ?? 0
		);
		const strict = derived(
			'strict',
			(k: string) => k,
			(cx, k: string) => {
				const v = cx.get(cell, k);
				if (v < 0) throw new Error('negative');
				return v;
			}
		);
		const db = queries('test');
		const { reads } = db.watch((cx) => cx.get(strict, 'a'));
		const since = db.revision;
		db.set(cell, 'a', -1);
		expect(db.moved(reads)).toBe(true);
		expect(db.answers_changed_since(since)).toBe(true);
	});

	test('setting an input to the value it has is no new revision', () => {
		const w = world();
		const db = queries('test');
		expect(db.set(w.cell, 'a', 2)).toBe(true);
		const rev = db.revision;
		expect(db.set(w.cell, 'a', 2)).toBe(false);
		expect(db.revision).toBe(rev);
	});

	test('refresh reads an input again only when something read it', () => {
		const w = world();
		const db = queries('test');
		w.cells.set('a', 1);
		expect(db.refresh(w.cell, 'a')).toBe(false); // nobody read it: nothing to tell
		expect(db.get(w.label, 'a')).toBe('odd');
		w.cells.set('a', 2);
		expect(db.refresh(w.cell, 'a')).toBe(true);
		expect(db.get(w.label, 'a')).toBe('even');
	});

	test('reread reads every input again; answers_changed_since tells whether an answer moved', () => {
		const w = world();
		const db = queries('test');
		db.get(w.label, 'a');
		const rev = db.revision;
		w.cells.set('a', 2); // same parity
		expect(db.reread()).toBe(true);
		expect(db.answers_changed_since(rev)).toBe(false);
		const rev2 = db.revision;
		w.cells.set('a', 3);
		expect(db.reread()).toBe(true);
		expect(db.answers_changed_since(rev2)).toBe(true);
	});

	test('a query that reads itself throws, and the database still answers after', () => {
		const db = queries('test');
		const loop: ReturnType<typeof derived<string, number>> = derived(
			'loop',
			(k: string) => k,
			(cx, k: string) => cx.get(loop, k)
		);
		expect(() => db.get(loop, 'x')).toThrow(/query cycle: loop x/);
		const w = world();
		expect(db.get(w.label, 'a')).toBe('even');
	});

	test('answers let go past the bound are computed again, right', () => {
		const w = world();
		const db = queries('test', 3);
		for (const k of ['a', 'b', 'c', 'd']) db.get(w.label, k);
		w.cells.set('a', 1);
		db.refresh(w.cell, 'a');
		db.set(w.cell, 'a', 1);
		expect(db.get(w.label, 'a')).toBe('odd');
		expect(db.get(w.label, 'd')).toBe('even');
	});

	test('a chain of answers a hundred thousand deep is checked after an edit without a stack overflow', () => {
		const depth = 100_000;
		const db = queries('test', 2 * depth);
		const cell = input(
			'cell',
			(k: string) => k,
			() => 0
		);
		const chain: ReturnType<typeof derived<number, number>> = derived(
			'chain',
			(n: number) => String(n),
			(cx, n: number) => (n === 0 ? cx.get(cell, 'a') : cx.get(chain, n - 1) + 1)
		);
		for (let n = 0; n <= depth; n++) db.get(chain, n);
		db.set(cell, 'a', 5);
		expect(db.get(chain, depth)).toBe(depth + 5);
		db.set(cell, 'b', 1);
		expect(db.get(chain, depth)).toBe(depth + 5);
	});

	test('a recompute that reads fewer answers than before forgets the rest', () => {
		const db = queries('test');
		const cell = input(
			'cell',
			(k: string) => k,
			() => 0
		);
		let runs = 0;
		const pick = derived(
			'pick',
			(k: string) => k,
			(cx) => {
				runs++;
				return cx.get(cell, 'switch') === 0 ? cx.get(cell, 'a') + cx.get(cell, 'b') : -1;
			}
		);
		expect(db.get(pick, 'x')).toBe(0);
		db.set(cell, 'switch', 1);
		expect(db.get(pick, 'x')).toBe(-1);
		db.set(cell, 'b', 7); // read before the switch, not after
		expect(db.get(pick, 'x')).toBe(-1);
		expect(runs).toBe(2);
	});

	test('an answer whose run threw runs again when next read, even if nothing it read moved', () => {
		const db = queries('test');
		const cell = input(
			'cell',
			(k: string) => k,
			() => 0
		);
		let fail = false;
		const flaky = derived(
			'flaky',
			(k: string) => k,
			(cx, k: string) => {
				const v = cx.get(cell, k);
				if (fail) throw new Error('flaky');
				return v;
			}
		);
		expect(db.get(flaky, 'a')).toBe(0);
		fail = true;
		db.set(cell, 'a', 1);
		expect(() => db.get(flaky, 'a')).toThrow('flaky');
		expect(() => db.get(flaky, 'a')).toThrow('flaky');
		fail = false;
		expect(db.get(flaky, 'a')).toBe(1);
		expect(db.holds(flaky, 'a')).toBe(true);
	});

	test('an answer whose first run threw is not held', () => {
		const db = queries('test');
		const boom = derived(
			'boom',
			(k: string) => k,
			(): number => {
				throw new Error('boom');
			}
		);
		expect(() => db.get(boom, 'a')).toThrow('boom');
		expect(db.holds(boom, 'a')).toBe(false);
		expect(db.answers_changed_since(0)).toBe(false);
	});

	test('past the bound, the answer used longest ago goes first: a set and a read in a later revision are uses', () => {
		const w = world();
		const db = queries('test', 3);
		for (const k of ['a', 'b', 'c']) db.get(w.cell, k);
		db.set(w.cell, 'a', 1);
		db.get(w.cell, 'd');
		db.get(w.cell, 'c');
		db.get(w.cell, 'e');
		expect(['a', 'b', 'c', 'd', 'e'].map((k) => db.holds(w.cell, k))).toEqual([
			false,
			false,
			true,
			true,
			true
		]);
	});

	test('a query that reads itself throws as a cycle even when the bound lets it go while it runs', () => {
		const db = queries('test', 1);
		const a: ReturnType<typeof derived<string, number>> = derived(
			'a',
			(k: string) => k,
			(cx, k: string) => cx.get(b, k)
		);
		const b: ReturnType<typeof derived<string, number>> = derived(
			'b',
			(k: string) => k,
			(cx, k: string) => cx.get(a, k)
		);
		expect(() => db.get(a, 'x')).toThrow(/query cycle: a x/);
	});

	test('answers run deeper than the bound still answer right after an edit', () => {
		const cells = new Map<string, number>();
		const cell = input(
			'cell',
			(k: string) => k,
			(k: string) => cells.get(k) ?? 0
		);
		const chain: ReturnType<typeof derived<number, number>> = derived(
			'chain',
			(n: number) => String(n),
			(cx, n: number) => (n === 0 ? cx.get(cell, 'a') : cx.get(chain, n - 1) + 1)
		);
		const db = queries('test', 2);
		expect(db.get(chain, 5)).toBe(5);
		cells.set('a', 20);
		db.set(cell, 'a', 20);
		expect(db.get(chain, 5)).toBe(25);
	});

	test('a reader of an answer the bound let go runs again, and answers right', () => {
		const w = world();
		const db = queries('test', 3);
		db.get(w.cell, 'a');
		expect(db.get(w.label, 'a')).toBe('even');
		db.get(w.cell, 'x');
		expect(db.holds(w.cell, 'a')).toBe(false);
		db.set(w.cell, 'x', 1);
		expect(db.get(w.label, 'a')).toBe('even');
		expect(w.runs.get('parity a')).toBe(2);
		expect(w.runs.get('label a')).toBe(1);
	});

	test('same: structure, Maps and Sets in order', () => {
		expect(same({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
		expect(same({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
		expect(same(new Map([['a', true]]), new Map([['a', true]]))).toBe(true);
		expect(same(new Map([['a', true]]), new Map([['a', false]]))).toBe(false);
		expect(same(new Set([1]), new Map([[1, 1]]))).toBe(false);
		expect(same([1], { 0: 1 })).toBe(false);
		expect(same(undefined, null)).toBe(false);
	});
});

// ── Kit's route answers: dev (one reader told of each edit) matches a cold start ──────────────

const ROUTES = '/app/src/routes';
const DIRS = ['', 'a', 'a/b', '(g)', '(g)/c'];
const COMPONENTS = ['+page.svelte', '+layout.svelte', '+page.md', '+page@.svelte'];
const OPTIONS = ['+page.ts', '+layout.ts', '+page.server.ts', '+layout.server.ts'];
const KEYS = ['tier'];
const OPTION_TEXT = [
	'',
	'export const csr = false;\n',
	'export const csr = true;\n',
	'// export const csr = false;\n',
	"export const config = { tier: 'gold' };\n",
	dedent`
		export const csr = false;
		export const config = { tier: 'free' };
	`
];

const file_of = (dir: string, name: string) =>
	dir ? `${ROUTES}/${dir}/${name}` : `${ROUTES}/${name}`;

/** One edit: a file written (a component's text, or option text) or removed. */
const edit_arb = fc.oneof(
	fc.record({
		file: fc.tuple(fc.constantFrom(...DIRS), fc.constantFrom(...COMPONENTS)),
		text: fc.option(fc.constantFrom('<h1>x</h1>\n', '<h1>y</h1>\n'), { nil: null })
	}),
	fc.record({
		file: fc.tuple(fc.constantFrom(...DIRS), fc.constantFrom(...OPTIONS)),
		text: fc.option(fc.constantFrom(...OPTION_TEXT), { nil: null })
	})
);

/** Every route answer the compiler reads, for the app as it is now. */
function answers(r: Routes, fs: MemoryFs): unknown {
	const guard = (f: () => unknown) => {
		try {
			return f();
		} catch (e) {
			return { throws: (e as Error).message };
		}
	};
	const hosts = fs.files().filter((f) => f.endsWith('.svelte') || f.endsWith('.md'));
	return {
		csr_true: guard(() => csrTrueRouteIds(r, ROUTES).sort()),
		error_csr_true: guard(() => errorCsrTrueRouteIds(r, ROUTES).sort()),
		root_csr_true: guard(() => rootLayoutCsrTrue(r, ROUTES)),
		any_true: guard(() => hasAnyCsrTrueRoute(r, ROUTES)),
		any_false: guard(() => hasAnyCsrFalseRoute(r, ROUTES)),
		skip: guard(() => clientBuildWillSkip(r, ROUTES)),
		config: guard(() => page_route_config(r, ROUTES, KEYS)),
		hosts: hosts.map((h) => [
			h,
			guard(() => routeCsrIsFalse(r, h, ROUTES)),
			guard(() => routeCsrIsTrue(r, h, ROUTES))
		])
	};
}

describe('route answers in dev match a cold start', () => {
	test('after any run of edits, each told to the reader as the watcher tells it', () => {
		fc.assert(
			fc.property(
				fc.array(edit_arb, { maxLength: 8 }),
				fc.array(edit_arb, { minLength: 1, maxLength: 20 }),
				(start, edits) => {
					const dev = memory_fs({ [file_of('', '+page.svelte')]: '<h1>home</h1>\n' });
					for (const { file, text } of start) dev.set(file_of(...file), text);
					const r = route_reader(dev);
					answers(r, dev);
					for (const { file, text } of edits) {
						const abs = file_of(...file);
						const had = dev.read(abs) !== null;
						dev.set(abs, text);
						const event = text === null ? 'delete' : had ? 'update' : 'create';
						if (text === null && !had) continue; // no file, no event
						r.touch(abs, event);
						const cold = memory_fs(Object.fromEntries(dev.files().map((f) => [f, dev.read(f)!])));
						expect(answers(r, dev)).toEqual(answers(route_reader(cold), cold));
					}
				}
			),
			{ numRuns: Number(process.env.QUERIES_RUNS) || 300 }
		);
	}, 600_000);

	test('touch says false for an edit that leaves every route answer as it was', () => {
		const fs = memory_fs({
			[file_of('', '+page.svelte')]: '<h1>home</h1>\n',
			[file_of('', '+layout.ts')]: 'export const csr = false;\n'
		});
		const r = route_reader(fs);
		answers(r, fs);
		fs.set(file_of('', '+page.svelte'), '<h1>home, again</h1>\n');
		expect(r.touch(file_of('', '+page.svelte'), 'update')).toBe(false);
		fs.set(
			file_of('', '+layout.ts'),
			dedent`
				// the root
				export const csr = false;
			`
		);
		expect(r.touch(file_of('', '+layout.ts'), 'update')).toBe(false);
		fs.set(file_of('', '+layout.ts'), 'export const csr = true;\n');
		expect(r.touch(file_of('', '+layout.ts'), 'update')).toBe(true);
	});
});
