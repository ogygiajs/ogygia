import { afterEach, describe, expect, it, vi } from 'vitest';
import { MachineError, machine, observe, STALE, type Observer } from '../src/index.ts';

const hole = machine<{
	idle: {};
	fetching: { attempt: number };
	applying: {};
	answered: { revalidated: boolean };
	kept: {};
	failed: { error: unknown; attempt: number };
	gone: {};
}>()({
	name: 'hole',
	initial: 'idle',
	steps: {
		idle: ['fetching', 'gone'],
		fetching: ['applying', 'failed', 'idle', 'fetching'],
		applying: ['answered', 'kept', 'failed'],
		answered: ['fetching'],
		kept: ['applying'],
		failed: ['fetching', 'gone'],
		gone: []
	}
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('definition', () => {
	it('keeps its name, initial and steps, frozen', () => {
		expect(hole.name).toBe('hole');
		expect(hole.initial).toBe('idle');
		expect(hole.steps.fetching).toEqual(['applying', 'failed', 'idle', 'fetching']);
		expect(Object.isFrozen(hole)).toBe(true);
		expect(Object.isFrozen(hole.steps)).toBe(true);
		expect(Object.isFrozen(hole.steps.idle)).toBe(true);
	});

	it('copies the steps: changing the object it was given changes nothing', () => {
		const steps = { a: ['b'], b: [] as string[] };
		const def = machine<{ a: {}; b: {} }>()({
			name: 'copy',
			initial: 'a',
			steps: steps as unknown as { readonly a: readonly ['b']; readonly b: readonly [] }
		});
		steps.a.push('a');
		expect(def.steps.a).toEqual(['b']);
		expect(def.create().go('b')).toBe(true);
	});

	it('refuses an initial state that is not a state', () => {
		expect(() =>
			machine<{ a: {} }>()({ name: 'bad', initial: 'nope' as 'a', steps: { a: [] } })
		).toThrow(/machine_unknown_state/);
	});

	it('refuses a step to a state that is not a state', () => {
		expect(() =>
			machine<{ a: {} }>()({ name: 'bad', initial: 'a', steps: { a: ['nope' as 'a'] } })
		).toThrow(/"nope" \(a step of "a"\) is not one of its states/);
	});

	it('refuses a state that can never be reached', () => {
		expect(() =>
			machine<{ a: {}; b: {}; c: {} }>()({
				name: 'island',
				initial: 'a',
				steps: { a: ['b'], b: ['a'], c: ['a'] }
			})
		).toThrow(/state "c" can never be reached from "a"/);
	});

	it('refuses a step listed twice', () => {
		expect(() =>
			machine<{ a: {}; b: {} }>()({ name: 'twice', initial: 'a', steps: { a: ['b', 'b'], b: [] } })
		).toThrow(/machine_duplicate_step/);
	});

	it('names its error: a MachineError with the code and its page', () => {
		try {
			machine<{ a: {} }>()({ name: 'bad', initial: 'nope' as 'a', steps: { a: [] } });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(MachineError);
			expect((error as MachineError).code).toBe('machine_unknown_state');
			expect((error as MachineError).message).toContain(
				'https://ogygiajs.dev/e/machine_unknown_state?name=bad&state=nope&where=initial'
			);
		}
	});

	it('treats state names like Object.prototype keys as plain names', () => {
		const odd = machine<{ toString: {}; constructor: {}; hasOwnProperty: {} }>()({
			name: 'odd',
			initial: 'toString',
			steps: { toString: ['constructor'], constructor: ['hasOwnProperty'], hasOwnProperty: [] }
		});
		const m = odd.create();
		expect(() => m.go('hasOwnProperty')).toThrow(/cannot go from "toString" to "hasOwnProperty"/);
		expect(m.go('constructor')).toBe(true);
		expect(m.go('hasOwnProperty')).toBe(true);
		expect(m.now.kind).toBe('hasOwnProperty');
	});

	it('a one-state machine works (initial, final)', () => {
		const one = machine<{ only: {} }>()({ name: 'one', initial: 'only', steps: { only: [] } });
		const m = one.create();
		expect(m.now).toEqual({ kind: 'only' });
	});

	it('starts in an initial state that carries data', () => {
		const counted = machine<{ at: { n: number }; done: {} }>()({
			name: 'counted',
			initial: 'at',
			steps: { at: ['at', 'done'], done: [] }
		});
		const m = counted.create({ n: 3 });
		expect(m.now).toEqual({ kind: 'at', n: 3 });
	});
});

describe('now', () => {
	it('starts in initial, a value of its own, frozen in dev', () => {
		const a = hole.create();
		const b = hole.create();
		expect(a.now).toEqual({ kind: 'idle' });
		expect(a.now).not.toBe(b.now);
		expect(Object.isFrozen(a.now)).toBe(true);
	});

	it('is the same value for as long as the visit lasts', () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		m.go('applying');
		const mine = m.now;
		expect(m.now).toBe(mine);
		m.move('fetching', 'idle'); // refused: not in fetching
		expect(m.now).toBe(mine);
	});

	it('is a new value on every visit, with no data too: a saved now tells the visits apart', () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		m.go('applying');
		const mine = m.now;
		m.go('kept');
		m.go('applying'); // back in the same dataless state: a later visit
		expect(m.now).toEqual(mine);
		expect(m.now).not.toBe(mine);
	});

	it('a dataless step to itself is a new visit too', () => {
		const tick = machine<{ on: {} }>()({ name: 'tick', initial: 'on', steps: { on: ['on'] } });
		const m = tick.create();
		const mine = m.now;
		m.go('on');
		expect(m.now).not.toBe(mine);
	});

	it('carries the data of the state it is in, frozen in dev', () => {
		const m = hole.create();
		m.go('fetching', { attempt: 2 });
		expect(m.now).toEqual({ kind: 'fetching', attempt: 2 });
		expect(Object.isFrozen(m.now)).toBe(true);
	});

	it('copies the data: changing the object passed in changes nothing', () => {
		const m = hole.create();
		const data = { attempt: 1 };
		m.go('fetching', data);
		data.attempt = 9;
		const s = m.now;
		expect(s.kind === 'fetching' && s.attempt).toBe(1);
	});

	it('refuses data with its own kind', () => {
		const m = hole.create();
		expect(() => m.go('fetching', { attempt: 1, kind: 'x' } as never)).toThrow(
			/machine_kind_in_data/
		);
		expect(m.now.kind).toBe('idle');
	});

	it('a dataless state entered with {} is still that state', () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		(m.go as (to: string, data: object) => boolean)('idle', {});
		expect(m.now).toEqual({ kind: 'idle' });
	});
});

describe('go', () => {
	it('moves along a step and says so', () => {
		const m = hole.create();
		expect(m.go('fetching', { attempt: 1 })).toBe(true);
		expect(m.go('applying')).toBe(true);
		expect(m.go('answered', { revalidated: false })).toBe(true);
		expect(m.now.kind).toBe('answered');
	});

	it('throws in dev for a move the steps do not allow, and stays put', () => {
		const m = hole.create();
		expect(() => m.go('applying')).toThrow(/machine hole: cannot go from "idle" to "applying"/);
		expect(m.now.kind).toBe('idle');
	});

	it('a final state goes nowhere', () => {
		const m = hole.create();
		m.go('gone');
		expect(() => m.go('fetching', { attempt: 1 })).toThrow(/from "gone" to "fetching"/);
	});

	it('a state can step to itself (a fresh visit)', () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		const leave = vi.fn();
		m.scope.defer(leave);
		expect(m.go('fetching', { attempt: 2 })).toBe(true);
		expect(leave).toHaveBeenCalledOnce();
		const s = m.now;
		expect(s.kind === 'fetching' && s.attempt).toBe(2);
	});
});

describe('move', () => {
	it('moves when the machine is still in from', () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		expect(m.move('fetching', 'applying')).toBe(true);
		expect(m.now.kind).toBe('applying');
	});

	it('refuses quietly when something else moved it first', () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		m.go('idle');
		expect(m.move('fetching', 'applying')).toBe(false);
		expect(m.now.kind).toBe('idle');
	});

	it('throws in dev for a step that does not exist, even when not in from', () => {
		const m = hole.create();
		const untyped = m.move.bind(m) as (from: string, to: string) => boolean;
		expect(() => untyped('answered', 'kept')).toThrow(/from "answered" to "kept"/);
		expect(() => untyped('nope', 'idle')).toThrow(/from "nope" to "idle"/);
	});
});

describe('scope.task: work of one visit', () => {
	it('gives the answer while the machine stays put', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		await expect(m.scope.task(async () => 'html')).resolves.toBe('html');
	});

	it('takes a plain value too', async () => {
		const m = hole.create();
		await expect(m.scope.task(() => 7)).resolves.toBe(7);
	});

	it('passes a live signal, aborted once the machine leaves', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		let seen: AbortSignal | undefined;
		const out = m.scope.task(
			(signal) =>
				new Promise<string>((resolve, reject) => {
					seen = signal;
					signal.addEventListener('abort', () => reject(signal.reason));
					setTimeout(() => resolve('late'), 50);
				})
		);
		expect(seen?.aborted).toBe(false);
		m.go('idle');
		expect(seen?.aborted).toBe(true);
		await expect(out).resolves.toBe(STALE);
	});

	it('drops an answer that lands after the machine left', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		let finish!: (v: string) => void;
		const out = m.scope.task(() => new Promise<string>((r) => (finish = r)));
		m.go('failed', { error: 'x', attempt: 1 });
		finish('late');
		await expect(out).resolves.toBe(STALE);
	});

	it('drops it even when the machine came back to the same state (a new visit)', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		let finish!: (v: string) => void;
		const out = m.scope.task(() => new Promise<string>((r) => (finish = r)));
		m.go('idle');
		m.go('fetching', { attempt: 2 });
		finish('from visit 1');
		await expect(out).resolves.toBe(STALE);
	});

	it('drops it on a step to itself too', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		let finish!: (v: string) => void;
		const out = m.scope.task(() => new Promise<string>((r) => (finish = r)));
		m.go('fetching', { attempt: 2 });
		finish('old');
		await expect(out).resolves.toBe(STALE);
	});

	it('rejects with the failure while the machine stays put', async () => {
		const m = hole.create();
		const boom = new Error('boom');
		await expect(m.scope.task(async () => Promise.reject(boom))).rejects.toBe(boom);
	});

	it('turns a failure after the machine left into STALE (no unhandled error)', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		let fail!: (e: unknown) => void;
		const out = m.scope.task(() => new Promise((_, reject) => (fail = reject)));
		m.go('idle');
		fail(new Error('after'));
		await expect(out).resolves.toBe(STALE);
	});

	it('turns a synchronous throw into a rejection', async () => {
		const m = hole.create();
		const boom = new Error('sync');
		await expect(
			m.scope.task(() => {
				throw boom;
			})
		).rejects.toBe(boom);
	});

	it('work that moves the machine itself gives STALE', async () => {
		const m = hole.create();
		const out = m.scope.task(() => {
			m.go('fetching', { attempt: 1 });
			return 'x';
		});
		await expect(out).resolves.toBe(STALE);
	});

	it('tasks of one visit share one signal; the next visit gets a new one', () => {
		const m = hole.create();
		const signals: AbortSignal[] = [];
		void m.scope.task((s) => signals.push(s));
		void m.scope.task((s) => signals.push(s));
		m.go('fetching', { attempt: 1 });
		void m.scope.task((s) => signals.push(s));
		expect(signals[0]).toBe(signals[1]);
		expect(signals[0].aborted).toBe(true);
		expect(signals[2]).not.toBe(signals[0]);
		expect(signals[2].aborted).toBe(false);
	});

	it('settles with STALE the moment the machine leaves, even when work never finishes', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		const out = m.scope.task(() => new Promise<string>(() => {}));
		let settled: unknown = 'pending';
		void out.then((v) => (settled = v));
		await flush();
		expect(settled).toBe('pending');
		m.go('idle');
		await flush();
		expect(settled).toBe(STALE);
	});

	it('work that ignores its signal and answers late still gives STALE once', async () => {
		const m = hole.create();
		let finish!: (v: string) => void;
		const out = m.scope.task(() => new Promise<string>((r) => (finish = r)));
		m.go('fetching', { attempt: 1 });
		finish('late');
		await expect(out).resolves.toBe(STALE);
	});

	it('a stopped machine does not run work', async () => {
		const m = hole.create();
		m.stop();
		const work = vi.fn(() => 1);
		await expect(m.scope.task(work)).resolves.toBe(STALE);
		expect(work).not.toHaveBeenCalled();
	});

	it('a move with no task makes no abort controller', () => {
		const spy = vi.spyOn(globalThis, 'AbortController');
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		m.go('idle');
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('scope.defer: cleanups of one visit', () => {
	it('runs once when the machine leaves, newest first', () => {
		const m = hole.create();
		const order: string[] = [];
		m.scope.defer(() => order.push('a'));
		m.scope.defer(() => order.push('b'));
		m.go('fetching', { attempt: 1 });
		m.go('idle');
		expect(order).toEqual(['b', 'a']);
	});

	it('belongs to the visit it was added in', () => {
		const m = hole.create();
		const first = vi.fn();
		m.scope.defer(first);
		m.go('fetching', { attempt: 1 });
		const second = vi.fn();
		m.scope.defer(second);
		expect(first).toHaveBeenCalledOnce();
		expect(second).not.toHaveBeenCalled();
		m.go('idle');
		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
	});

	it('sees the new state already in place', () => {
		const m = hole.create();
		let seen = '';
		m.scope.defer(() => (seen = m.now.kind));
		m.go('fetching', { attempt: 1 });
		expect(seen).toBe('fetching');
	});

	it('one that throws does not stop the others or the move; the move throws after', () => {
		const m = hole.create();
		const after = vi.fn();
		const boom = new Error('cleanup');
		m.scope.defer(after);
		m.scope.defer(() => {
			throw boom;
		});
		expect(() => m.go('fetching', { attempt: 1 })).toThrow(boom);
		expect(after).toHaveBeenCalledOnce();
		expect(m.now.kind).toBe('fetching');
	});

	it('several that throw come back together', () => {
		const m = hole.create();
		m.scope.defer(() => {
			throw new Error('one');
		});
		m.scope.defer(() => {
			throw new Error('two');
		});
		try {
			m.go('fetching', { attempt: 1 });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(AggregateError);
			expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(['two', 'one']);
		}
		expect(m.now.kind).toBe('fetching');
	});

	it('a cleanup that moves the machine again works, and the next visit starts clean', () => {
		const m = hole.create();
		const later = vi.fn();
		m.scope.defer(() => {
			m.go('applying');
			m.scope.defer(later);
		});
		m.go('fetching', { attempt: 1 });
		expect(m.now.kind).toBe('applying');
		expect(later).not.toHaveBeenCalled();
		m.go('kept');
		expect(later).toHaveBeenCalledOnce();
	});

	it('runs at once on a stopped machine', () => {
		const m = hole.create();
		m.stop();
		const cleanup = vi.fn();
		m.scope.defer(cleanup);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('the signal aborts before the cleanups run', () => {
		const m = hole.create();
		let aborted: boolean | undefined;
		let signal!: AbortSignal;
		void m.scope.task((s) => (signal = s));
		m.scope.defer(() => (aborted = signal.aborted));
		m.go('fetching', { attempt: 1 });
		expect(aborted).toBe(true);
	});

	it('a refused move runs no cleanup', () => {
		const m = hole.create();
		const cleanup = vi.fn();
		m.scope.defer(cleanup);
		expect(m.move('failed', 'fetching', { attempt: 1 })).toBe(false);
		expect(() => m.go('kept')).toThrow();
		expect(cleanup).not.toHaveBeenCalled();
	});
});

describe('wait', () => {
	it('settles at once when the machine is in the state', async () => {
		const m = hole.create();
		await expect(m.wait('idle')).resolves.toEqual({ kind: 'idle' });
	});

	it('settles with the state when the machine gets there', async () => {
		const m = hole.create();
		const answered = m.wait('answered');
		m.go('fetching', { attempt: 1 });
		m.go('applying');
		m.go('answered', { revalidated: true });
		await expect(answered).resolves.toEqual({ kind: 'answered', revalidated: true });
	});

	it('settles with the state it entered, even if the machine moved on since', async () => {
		const m = hole.create();
		const fetching = m.wait('fetching');
		m.go('fetching', { attempt: 1 });
		m.go('idle');
		await expect(fetching).resolves.toEqual({ kind: 'fetching', attempt: 1 });
	});

	it('gives STALE as soon as the state cannot be reached any more', async () => {
		const m = hole.create();
		const answered = m.wait('answered');
		let settled: unknown = 'pending';
		void answered.then((v) => (settled = v));
		m.go('fetching', { attempt: 1 });
		await flush();
		expect(settled).toBe('pending');
		m.go('failed', { error: 'x', attempt: 1 });
		await flush();
		expect(settled).toBe('pending'); // failed → fetching → … → answered is still possible
		m.go('gone');
		await expect(answered).resolves.toBe(STALE);
	});

	it('gives STALE at once when the state is out of reach already', async () => {
		const m = hole.create();
		m.go('gone');
		await expect(m.wait('answered')).resolves.toBe(STALE);
	});

	it('many waits on many states settle each in turn', async () => {
		const m = hole.create();
		const a = m.wait('fetching');
		const b = m.wait('applying');
		const c = m.wait('kept');
		m.go('fetching', { attempt: 1 });
		m.go('applying');
		m.go('kept');
		expect(await a).toEqual({ kind: 'fetching', attempt: 1 });
		expect(await b).toEqual({ kind: 'applying' });
		expect(await c).toEqual({ kind: 'kept' });
	});

	it('stop settles every wait with STALE', async () => {
		const m = hole.create();
		const a = m.wait('answered');
		const b = m.wait('fetching');
		m.stop();
		expect(await a).toBe(STALE);
		expect(await b).toBe(STALE);
		await expect(m.wait('idle')).resolves.toBe(STALE);
	});

	it('throws in dev for a state that does not exist', () => {
		const m = hole.create();
		expect(() => m.wait('nope' as never)).toThrow(/"nope" \(wait\(\)\) is not one of its states/);
	});
});

describe('stop', () => {
	it('aborts tasks, runs cleanups, settles waits, refuses moves quietly', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		let signal!: AbortSignal;
		const out = m.scope.task((s) => {
			signal = s;
			return new Promise(() => {});
		});
		const cleanup = vi.fn();
		m.scope.defer(cleanup);
		const w = m.wait('answered');
		m.stop();
		expect(signal.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(await w).toBe(STALE);
		expect(await out).toBe(STALE);
		expect(m.go('applying')).toBe(false);
		expect(m.go('kept')).toBe(false); // illegal too, but a stopped machine refuses quietly
		expect(m.move('fetching', 'applying')).toBe(false);
		expect(m.now.kind).toBe('fetching');
	});

	it('twice is the same as once', () => {
		const m = hole.create();
		const cleanup = vi.fn();
		m.scope.defer(cleanup);
		m.stop();
		m.stop();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('a cleanup that throws on stop still runs the rest, then throws', () => {
		const m = hole.create();
		const rest = vi.fn();
		m.scope.defer(rest);
		m.scope.defer(() => {
			throw new Error('x');
		});
		expect(() => m.stop()).toThrow('x');
		expect(rest).toHaveBeenCalledOnce();
		expect(m.go('fetching', { attempt: 1 })).toBe(false);
	});
});

describe('observe', () => {
	let off: (() => void) | null = null;
	afterEach(() => off?.());

	it('hears every move and the stop, with the machine', () => {
		const seen: string[] = [];
		const m = hole.create();
		off = observe((name, from, to, who) => {
			seen.push(`${name}:${from.kind}>${to?.kind ?? 'stop'}`);
			expect(who).toBe(m);
		});
		m.go('fetching', { attempt: 1 });
		m.move('fetching', 'idle');
		m.stop();
		expect(seen).toEqual(['hole:idle>fetching', 'hole:fetching>idle', 'hole:idle>stop']);
	});

	it('hears nothing for a refused move', () => {
		const seen = vi.fn<Observer>();
		off = observe(seen);
		const m = hole.create();
		m.move('fetching', 'idle');
		expect(() => m.go('kept')).toThrow();
		expect(seen).not.toHaveBeenCalled();
	});

	it('stops hearing once it unsubscribes', () => {
		const seen = vi.fn<Observer>();
		const stop = observe(seen);
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		stop();
		m.go('idle');
		expect(seen).toHaveBeenCalledOnce();
	});

	it('an observer that throws does not break the move or the other observers', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const second = vi.fn<Observer>();
		const off_a = observe(() => {
			throw new Error('observer');
		});
		const off_b = observe(second);
		const m = hole.create();
		expect(m.go('fetching', { attempt: 1 })).toBe(true);
		expect(m.now.kind).toBe('fetching');
		expect(second).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledOnce();
		off_a();
		off_b();
		error.mockRestore();
	});

	it('an observer that unsubscribes itself mid-move does not skip the next one', () => {
		const second = vi.fn<Observer>();
		const first: Observer = () => off_first();
		const off_first = observe(first);
		const off_second = observe(second);
		hole.create().go('fetching', { attempt: 1 });
		expect(second).toHaveBeenCalledOnce();
		off_second();
	});

	it('an observer that moves the machine again sees both moves in order', () => {
		const seen: string[] = [];
		const m = hole.create();
		off = observe((_, from, to) => {
			seen.push(`${from.kind}>${to?.kind}`);
			if (to?.kind === 'fetching') m.go('applying');
		});
		m.go('fetching', { attempt: 1 });
		expect(seen).toEqual(['idle>fetching', 'fetching>applying']);
		expect(m.now.kind).toBe('applying');
	});
});

describe('machines are independent', () => {
	it('two machines of one definition share nothing', () => {
		const a = hole.create();
		const b = hole.create();
		const leave_a = vi.fn();
		a.scope.defer(leave_a);
		b.go('fetching', { attempt: 1 });
		expect(a.now.kind).toBe('idle');
		expect(leave_a).not.toHaveBeenCalled();
	});

	it('machines of different definitions do not mix', () => {
		const light = machine<{ red: {}; green: {} }>()({
			name: 'light',
			initial: 'red',
			steps: { red: ['green'], green: ['red'] }
		});
		const l = light.create();
		const h = hole.create();
		l.go('green');
		h.go('fetching', { attempt: 1 });
		expect(l.now.kind).toBe('green');
		expect(h.now.kind).toBe('fetching');
	});

	it('the STALE symbol is the same across copies of the package', () => {
		expect(STALE).toBe(Symbol.for('ogygia.machine.stale'));
	});
});
