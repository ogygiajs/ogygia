// Type tests: `tsc -p test` (the package's `check`) fails when a line marked @ts-expect-error
// compiles, or when an expectTypeOf does not hold. The bodies under `compile_only` never run.
import { describe, expectTypeOf, it } from 'vitest';
import {
	flights,
	lock,
	mailbox,
	machine,
	scope,
	STALE,
	type LockToken,
	type Machine,
	type Stale
} from '../src/index.ts';

type Hole = {
	idle: {};
	fetching: { attempt: number };
	applying: {};
	failed: { error: unknown; attempt: number };
	maybe: { note?: string };
	done: {};
};
const hole = machine<Hole>()({
	name: 'hole',
	initial: 'idle',
	steps: {
		idle: ['fetching'],
		fetching: ['applying', 'failed', 'idle'],
		applying: ['done', 'maybe'],
		failed: ['fetching'],
		maybe: ['done'],
		done: []
	}
});

/** Holds code that only has to compile (or fail to): it never runs. */
function compile_only(body: () => void): void {
	void body;
}

describe('types', () => {
	it('now is a union that narrows on kind', () => {
		const m = hole.create();
		const s = m.now;
		expectTypeOf(s.kind).toEqualTypeOf<
			'idle' | 'fetching' | 'applying' | 'failed' | 'maybe' | 'done'
		>();
		if (s.kind === 'failed') {
			expectTypeOf(s.error).toEqualTypeOf<unknown>();
			expectTypeOf(s.attempt).toEqualTypeOf<number>();
		}
		if (s.kind === 'fetching')
			expectTypeOf(s).toEqualTypeOf<{ readonly kind: 'fetching'; readonly attempt: number }>();
		compile_only(() => {
			// @ts-expect-error: only `failed` has `error`
			void s.error;
			// @ts-expect-error: state values are readonly
			s.kind = 'idle';
		});
	});

	it('go takes only states some step leads to, with their data', () => {
		const m = hole.create();
		compile_only(() => {
			m.go('fetching', { attempt: 1 });
			m.go('applying');
			m.go('maybe');
			m.go('maybe', { note: 'x' });
		});
		compile_only(() => {
			// @ts-expect-error: `nope` is not a state
			m.go('nope');
			// @ts-expect-error: `idle` takes no data
			m.go('idle', { attempt: 1 });
			// @ts-expect-error: `fetching` needs its data
			m.go('fetching');
			// @ts-expect-error: wrong data
			m.go('fetching', { attempt: 'one' });
			// @ts-expect-error: `kind` cannot be passed as data
			m.go('fetching', { attempt: 1, kind: 'x' });
		});
	});

	it('move checks the step itself', () => {
		const m = hole.create();
		m.move('fetching', 'applying');
		m.move('fetching', 'failed', { error: 1, attempt: 1 });
		compile_only(() => {
			// @ts-expect-error: `idle` does not step to `applying`
			m.move('idle', 'applying');
			// @ts-expect-error: `done` is final
			m.move('done', 'idle');
			// @ts-expect-error: `failed` needs its data
			m.move('fetching', 'failed');
		});
	});

	it('task gives the answer or STALE', () => {
		const m = hole.create();
		expectTypeOf(m.scope.task(async () => 'x')).toEqualTypeOf<Promise<string | Stale>>();
		expectTypeOf(m.scope.task(() => 1)).toEqualTypeOf<Promise<number | Stale>>();
		compile_only(async () => {
			const r = await m.scope.task(async (signal) => {
				expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
				return 'x';
			});
			if (r === STALE) return;
			expectTypeOf(r).toEqualTypeOf<string>();
		});
	});

	it('wait gives that state or STALE', () => {
		const m = hole.create();
		expectTypeOf(m.wait('failed')).toEqualTypeOf<
			Promise<
				{ readonly kind: 'failed'; readonly error: unknown; readonly attempt: number } | Stale
			>
		>();
		compile_only(() => {
			// @ts-expect-error: not a state
			void m.wait('nope');
		});
	});

	it('create takes the initial state data when it has some', () => {
		const counted = machine<{ at: { n: number }; done: {} }>()({
			name: 'counted',
			initial: 'at',
			steps: { at: ['at', 'done'], done: [] }
		});
		counted.create({ n: 1 });
		expectTypeOf(hole.create()).toEqualTypeOf<Machine<Hole, typeof hole.steps>>();
		compile_only(() => {
			// @ts-expect-error: `at` needs its data
			counted.create();
			// @ts-expect-error: `idle` takes none
			hole.create({ n: 1 });
		});
	});

	it('the definition is checked as it is written', () => {
		compile_only(() => {
			machine<{ a: {}; b: {} }>()({
				name: 'x',
				initial: 'a',
				// @ts-expect-error: `b` is missing
				steps: { a: ['b'] }
			});
			machine<{ a: {}; b: {} }>()({
				name: 'x',
				initial: 'a',
				// @ts-expect-error: `c` is not a state
				steps: { a: ['c'], b: [] }
			});
			machine<{ a: {}; b: {} }>()({
				name: 'x',
				initial: 'a',
				// @ts-expect-error: `c` is not a state
				steps: { a: ['b'], b: [], c: [] }
			});
			machine<{ a: {}; b: {} }>()({
				name: 'x',
				// @ts-expect-error: `c` is not a state
				initial: 'c',
				steps: { a: ['b'], b: [] }
			});
			// @ts-expect-error: a state's data cannot have `kind`
			machine<{ a: { kind: string } }>();
		});
	});

	it('after: a timeout takes one of its state’s steps, with the data that state needs', () => {
		compile_only(() => {
			machine<{ a: { n: number }; b: { m: number }; c: {} }>()({
				name: 'ok',
				initial: 'a',
				steps: { a: ['b', 'c'], b: [], c: [] },
				after: {
					a: { ms: (s) => s.n * 10, to: 'b', data: (s) => ({ m: s.n }) },
					b: undefined
				}
			});
			machine<{ a: {}; b: {}; c: {} }>()({
				name: 'x',
				initial: 'a',
				steps: { a: ['b'], b: ['c'], c: [] },
				// @ts-expect-error: `c` is not one of `a`'s steps
				after: { a: { ms: 1, to: 'c' } }
			});
			machine<{ a: {}; b: { m: number } }>()({
				name: 'x',
				initial: 'a',
				steps: { a: ['b'], b: [] },
				// @ts-expect-error: `b` needs its data
				after: { a: { ms: 1, to: 'b' } }
			});
			machine<{ a: {}; b: { m: number } }>()({
				name: 'x',
				initial: 'a',
				steps: { a: ['b'], b: [] },
				// @ts-expect-error: wrong data
				after: { a: { ms: 1, to: 'b', data: () => ({ m: 'one' }) } }
			});
			machine<{ a: {}; b: {} }>()({
				name: 'x',
				initial: 'a',
				steps: { a: ['b'], b: [] },
				// @ts-expect-error: `b` takes no data
				after: { a: { ms: 1, to: 'b', data: () => ({}) } }
			});
		});
	});

	it('graph and paths name the states', () => {
		expectTypeOf(hole.graph().initial).toEqualTypeOf<
			'idle' | 'fetching' | 'applying' | 'failed' | 'maybe' | 'done'
		>();
		expectTypeOf(hole.paths()).toEqualTypeOf<
			('idle' | 'fetching' | 'applying' | 'failed' | 'maybe' | 'done')[][]
		>();
	});

	it('flights: one key takes no input, a keyed one its input, answers may be STALE', () => {
		const core = flights({ run: async () => 42 });
		expectTypeOf(core.get()).toEqualTypeOf<Promise<number | Stale>>();
		const pages = flights({
			run: (href: string, signal) => fetch(href, { signal }).then((r) => r.text()),
			keep: (html) => (html.length > 0 ? 1000 : 0)
		});
		compile_only(() => {
			expectTypeOf(pages.get('/a', { signal: new AbortController().signal })).toEqualTypeOf<
				Promise<string | Stale>
			>();
		});
		type Ask = { href: string; n: number; by: string };
		const keyed = flights.keyed<Ask>()({
			key: ['href', 'n'],
			ignore: { by: 'who asked, not what is fetched' },
			run: (i) => {
				expectTypeOf(i).toEqualTypeOf<Pick<Ask, 'href' | 'n' | 'by'>>();
				return i.n;
			}
		});
		const seen = keyed.peek({ href: '/a', n: 1 });
		if (seen?.kind === 'kept') expectTypeOf(seen.answer).toEqualTypeOf<number>();
		keyed.drop((key) => {
			expectTypeOf(key).toEqualTypeOf<Pick<Ask, 'href' | 'n'>>();
			return key.href.startsWith('/a');
		});
		expectTypeOf<Parameters<typeof keyed.get>[0]>().toEqualTypeOf<Ask>();
		compile_only(() => {
			// @ts-expect-error: a keyed flights needs its input
			void pages.get();
			// @ts-expect-error: a key is named by its fields
			keyed.peek('/a');
			flights.keyed<Ask>()({
				key: ['href'],
				// @ts-expect-error: run reads a field its key leaves out
				run: (i) => i.n
			});
			flights.keyed<Ask>()({
				key: ['href'],
				// @ts-expect-error: a field cannot be both in the key and ignored
				ignore: { href: 'twice' },
				run: (i) => i.href
			});
			// @ts-expect-error: a field the input does not have
			flights.keyed<Ask>()({ key: ['nope'], run: () => 0 });
			// @ts-expect-error: an unkeyed flights takes no key: its input is its key
			flights({ run: (i: Ask) => i.n, key: ['href'] });
		});
	});

	it('scope: listeners get the event their target names', () => {
		const s = scope();
		compile_only(() => {
			s.on(window, 'keydown', (event) => expectTypeOf(event).toEqualTypeOf<KeyboardEvent>());
			s.on(new AbortController().signal, 'abort', (event) =>
				expectTypeOf(event).toEqualTypeOf<Event>()
			);
		});
		expectTypeOf(s.task(() => 'x')).toEqualTypeOf<Promise<string | Stale>>();
		expectTypeOf(s.timeout(() => {}, 'frame')).toEqualTypeOf<() => void>();
		s.close();
	});

	it('lock', () => {
		const l = lock();
		const t = l.take();
		expectTypeOf(t).toEqualTypeOf<LockToken | null>();
		compile_only(() => {
			// @ts-expect-error: a plain number is not a token
			l.free(1);
		});
	});

	it('a stale part makes the whole wait stale: past the check, no slot is Stale (#378)', () => {
		const pages = flights({ run: (href: string) => Promise.resolve(href.length) });
		const s = scope();
		compile_only(async () => {
			const both = await s.task(() => Promise.all([Promise.resolve('module'), pages.get('/')]));
			if (both === STALE) return;
			const [a, b] = both;
			expectTypeOf(a).toEqualTypeOf<string>();
			expectTypeOf(b).toEqualTypeOf<number>();

			const box = mailbox(s);
			box.post(async (turn) => {
				const got = await turn.wait(Promise.all([pages.get('/a'), pages.get('/b')]));
				if (got === STALE) return;
				expectTypeOf(got).toEqualTypeOf<[number, number]>();
			});
			const asked = await box.ask(() => Promise.all([pages.get('/'), Promise.resolve(1)]));
			if (asked === STALE) return;
			expectTypeOf(asked).toEqualTypeOf<[number, number]>();

			const one = await s.task(() => pages.get('/'));
			if (one === STALE) return;
			expectTypeOf(one).toEqualTypeOf<number>();

			// (one level deep: an object keeps its Stale)
			const obj = await s.task(async (): Promise<{ page: number | Stale }> => ({
				page: await pages.get('/')
			}));
			if (obj === STALE) return;
			expectTypeOf(obj.page).toEqualTypeOf<number | Stale>();

			// a plain array of maybe-stale values
			const many = await s.task(() => Promise.all(['/a', '/b'].map((h) => pages.get(h))));
			if (many === STALE) return;
			expectTypeOf(many).toEqualTypeOf<number[]>();
		});
	});
});
