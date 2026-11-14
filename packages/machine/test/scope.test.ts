import { describe, expect, it, vi } from 'vitest';
import { machine, scope, STALE } from '../src/index.ts';
import { macrotask } from './_tick.ts';
import { ASYNC_DISPOSE, DISPOSE } from './_dispose.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const in_browser = typeof document !== 'undefined';

/** A Node-style emitter: `on` / `off` / `emit`, as small as can be (it runs in a browser too). */
function emitter() {
	const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
	return {
		on(type: string, fn: (...args: unknown[]) => void) {
			let set = listeners.get(type);
			if (!set) listeners.set(type, (set = new Set()));
			set.add(fn);
			return this;
		},
		off(type: string, fn: (...args: unknown[]) => void) {
			listeners.get(type)?.delete(fn);
			return this;
		},
		emit(type: string, ...args: unknown[]) {
			for (const fn of listeners.get(type) ?? []) fn(...args);
		},
		count: (type: string) => listeners.get(type)?.size ?? 0
	};
}

describe('close', () => {
	it('is safe to call twice, and says it closed', () => {
		const s = scope();
		const cleanup = vi.fn();
		s.defer(cleanup);
		expect(s.closed).toBe(false);
		s.close();
		s.close();
		s[DISPOSE]();
		expect(s.closed).toBe(true);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('runs cleanups once, newest first', () => {
		const s = scope();
		const order: string[] = [];
		s.defer(() => order.push('first'));
		s.defer(() => order.push('second'));
		s.close();
		expect(order).toEqual(['second', 'first']);
	});

	it('a cleanup given to a closed scope runs at once', () => {
		const s = scope();
		s.close();
		const cleanup = vi.fn();
		s.defer(cleanup);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('a cleanup that throws does not stop the others; close throws it after all have run', () => {
		const s = scope();
		const after = vi.fn();
		s.defer(after);
		s.defer(() => {
			throw new Error('one');
		});
		expect(() => s.close()).toThrow('one');
		expect(after).toHaveBeenCalledOnce();
	});

	it('more than one throws: an AggregateError, newest first', () => {
		const s = scope();
		s.defer(() => {
			throw new Error('one');
		});
		s.defer(() => {
			throw new Error('two');
		});
		try {
			s.close();
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(AggregateError);
			expect((error as AggregateError).message).toBe('[ogygia] scope: 2 cleanups threw');
			expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(['two', 'one']);
		}
	});

	it('a release that throws does not stop the other releases or the cleanups (#346)', async () => {
		const s = scope();
		const bad = emitter();
		bad.off = () => {
			throw new Error('off');
		};
		const good = new EventTarget();
		const heard = vi.fn();
		const ticks = vi.fn();
		const cleanup = vi.fn();
		s.on(bad, 'x', () => {});
		s.on(good, 'x', heard);
		s.every(ticks, 1);
		s.defer(cleanup);
		expect(() => s.close()).toThrow('off');
		good.dispatchEvent(new Event('x'));
		await wait(10);
		expect(heard).not.toHaveBeenCalled();
		expect(ticks).not.toHaveBeenCalled();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('works with `using`', () => {
		const cleanup = vi.fn();
		{
			using s = scope();
			s.defer(cleanup);
			expect(cleanup).not.toHaveBeenCalled();
		}
		expect(cleanup).toHaveBeenCalledOnce();
	});
});

describe('children', () => {
	it('close before the parent’s own cleanups, newest first', () => {
		const parent = scope();
		const order: string[] = [];
		parent.defer(() => order.push('parent'));
		const a = parent.child();
		a.defer(() => order.push('a'));
		const b = scope(parent);
		b.defer(() => order.push('b'));
		const grandchild = b.child();
		grandchild.defer(() => order.push('grandchild'));
		parent.close();
		expect(order).toEqual(['grandchild', 'b', 'a', 'parent']);
		expect(a.closed && b.closed && grandchild.closed).toBe(true);
	});

	it('a child can close sooner on its own, and the parent then lets go of it', () => {
		const parent = scope();
		const child = parent.child();
		const cleanup = vi.fn();
		child.defer(cleanup);
		child.close();
		expect(cleanup).toHaveBeenCalledOnce();
		parent.close();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('a long-lived parent holds none of the children that closed on their own', () => {
		const parent = scope();
		for (let i = 0; i < 20; i++) parent.child().close();
		const kept = (parent as unknown as { _children: Set<unknown> | null })._children;
		expect(kept?.size ?? 0).toBe(0);
		parent.close();
	});

	it('a closed scope’s child is closed', () => {
		const parent = scope();
		parent.close();
		const child = parent.child();
		expect(child.closed).toBe(true);
		const cleanup = vi.fn();
		child.defer(cleanup);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('a cleanup that gives the closing scope more work gets the closed behaviour', async () => {
		const s = scope();
		const target = new EventTarget();
		const heard = vi.fn();
		const work = vi.fn(() => 'ran');
		const late = vi.fn();
		let child!: ReturnType<typeof scope>;
		let task!: Promise<unknown>;
		s.defer(() => {
			child = s.child();
			task = s.task(work);
			s.on(target, 'ping', heard);
			s.timeout(late, 0);
			s.defer(late);
		});
		s.close();
		expect(child.closed).toBe(true);
		expect(await task).toBe(STALE);
		expect(work).not.toHaveBeenCalled();
		target.dispatchEvent(new Event('ping'));
		expect(heard).not.toHaveBeenCalled();
		expect(late).toHaveBeenCalledOnce(); // (the defer, at once; the timer never set)
		await wait(5);
		expect(late).toHaveBeenCalledOnce();
	});

	it('what a child throws is thrown by the parent’s close, after its own cleanups ran', () => {
		const parent = scope();
		const mine = vi.fn();
		parent.defer(mine);
		parent.child().defer(() => {
			throw new Error('child');
		});
		expect(() => parent.close()).toThrow('child');
		expect(mine).toHaveBeenCalledOnce();
	});
});

describe('signal', () => {
	it('aborts on close, before the cleanups run', () => {
		const s = scope();
		const signal = s.signal;
		let aborted: boolean | null = null;
		s.defer(() => (aborted = signal.aborted));
		expect(signal.aborted).toBe(false);
		s.close();
		expect(aborted).toBe(true);
	});

	it('is one signal for the scope’s life; a closed scope’s is already aborted', () => {
		const s = scope();
		expect(s.signal).toBe(s.signal);
		const late = scope();
		late.close();
		expect(late.signal.aborted).toBe(true);
	});

	it('a scope nothing asks a signal of makes no abort controller', () => {
		const spy = vi.spyOn(globalThis, 'AbortController');
		const s = scope();
		s.defer(() => {});
		s.timeout(() => {}, 10);
		s.close();
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('a child’s signal aborts before its parent’s', () => {
		const parent = scope();
		const child = parent.child();
		const order: string[] = [];
		child.signal.addEventListener('abort', () => order.push('child'));
		parent.signal.addEventListener('abort', () => order.push('parent'));
		parent.close();
		expect(order).toEqual(['child', 'parent']);
	});
});

describe('on', () => {
	it('listens on an event target until the scope closes', () => {
		const target = new EventTarget();
		const s = scope();
		const heard = vi.fn();
		s.on(target, 'ping', heard);
		target.dispatchEvent(new Event('ping'));
		s.close();
		target.dispatchEvent(new Event('ping'));
		expect(heard).toHaveBeenCalledOnce();
	});

	it('keeps the listener options (capture, once) and lets go early when asked', () => {
		const target = new EventTarget();
		const s = scope();
		const once = vi.fn();
		const early = vi.fn();
		s.on(target, 'ping', once, { once: true });
		const off = s.on(target, 'ping', early, true);
		target.dispatchEvent(new Event('ping'));
		off();
		off();
		target.dispatchEvent(new Event('ping'));
		expect(once).toHaveBeenCalledOnce();
		expect(early).toHaveBeenCalledOnce();
		s.close();
	});

	it('a capture listener given as an object is let go on close; so is a non-capture one with options', () => {
		const target = new EventTarget();
		const s = scope();
		const captured = vi.fn();
		const passive = vi.fn();
		s.on(target, 'ping', captured, { capture: true });
		s.on(target, 'ping', passive, { passive: true });
		s.close();
		target.dispatchEvent(new Event('ping'));
		expect(captured).not.toHaveBeenCalled();
		expect(passive).not.toHaveBeenCalled();
	});

	it('a once listener that fired lets go of itself: a long-lived scope does not pile them up (#348)', () => {
		const target = new EventTarget();
		const s = scope();
		const heard = vi.fn();
		for (let i = 0; i < 50; i++) {
			s.on(target, 'ping', heard, { once: true });
			target.dispatchEvent(new Event('ping'));
		}
		expect(heard).toHaveBeenCalledTimes(50);
		const held = (s as unknown as { _held: Set<unknown> | null })._held;
		expect(held?.size ?? 0).toBe(0);
		// (one that has not fired yet is still held, and goes with the scope)
		const late = vi.fn();
		s.on(target, 'ping', late, { once: true });
		s.close();
		target.dispatchEvent(new Event('ping'));
		expect(late).not.toHaveBeenCalled();
	});

	it('listens on a Node-style emitter (on / off)', () => {
		const e = emitter();
		const s = scope();
		const heard = vi.fn();
		s.on(e, 'data', (chunk: unknown, n: unknown) => heard(chunk, n));
		e.emit('data', 'a', 1);
		expect(e.count('data')).toBe(1);
		s.close();
		e.emit('data', 'b', 2);
		expect(heard.mock.calls).toEqual([['a', 1]]);
		expect(e.count('data')).toBe(0);
	});

	it('a closed scope does not listen at all', () => {
		const target = new EventTarget();
		const s = scope();
		s.close();
		const heard = vi.fn();
		const off = s.on(target, 'ping', heard);
		target.dispatchEvent(new Event('ping'));
		expect(heard).not.toHaveBeenCalled();
		off();
	});

	it.runIf(in_browser)('a real window listener is gone after close', () => {
		const s = scope();
		const heard = vi.fn();
		s.on(window, 'og-test-ping', heard);
		window.dispatchEvent(new Event('og-test-ping'));
		s.close();
		window.dispatchEvent(new Event('og-test-ping'));
		expect(heard).toHaveBeenCalledOnce();
	});
});

describe('timers', () => {
	it('timeout runs once after its time, real timers', async () => {
		const s = scope();
		const fn = vi.fn();
		s.timeout(fn, 10);
		await wait(2);
		expect(fn).not.toHaveBeenCalled();
		await wait(30);
		expect(fn).toHaveBeenCalledOnce();
		s.close();
	});

	it('closing clears a timeout that has not run; its cancel does too', async () => {
		const s = scope();
		const closed = vi.fn();
		const cancelled = vi.fn();
		s.timeout(closed, 5);
		const cancel = s.timeout(cancelled, 5);
		cancel();
		s.close();
		await wait(25);
		expect(closed).not.toHaveBeenCalled();
		expect(cancelled).not.toHaveBeenCalled();
	});

	it("'frame' and 'idle' run once (a frame, idle time, or the next task where there is none)", async () => {
		const s = scope();
		const frame = vi.fn();
		const idle = vi.fn();
		s.timeout(frame, 'frame');
		s.timeout(idle, 'idle');
		await wait(200);
		expect(frame).toHaveBeenCalledOnce();
		expect(idle).toHaveBeenCalledOnce();
		const gone = vi.fn();
		s.timeout(gone, 'frame');
		s.timeout(gone, 'idle');
		s.close();
		await wait(100);
		expect(gone).not.toHaveBeenCalled();
	});

	it("'frame' waits for the host's frame and 'idle' for its idle time; closing cancels each", () => {
		const frames = new Map<number, () => void>();
		const idles = new Map<number, () => void>();
		let next = 0;
		vi.stubGlobal('requestAnimationFrame', (fn: () => void) => (frames.set(++next, fn), next));
		vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
		vi.stubGlobal('requestIdleCallback', (fn: () => void) => (idles.set(++next, fn), next));
		vi.stubGlobal('cancelIdleCallback', (id: number) => idles.delete(id));
		try {
			const s = scope();
			const frame = vi.fn();
			const idle = vi.fn();
			s.timeout(frame, 'frame');
			s.timeout(idle, 'idle');
			expect([frames.size, idles.size]).toEqual([1, 1]);
			for (const fn of frames.values()) fn();
			expect(frame).toHaveBeenCalledOnce();
			expect(idle).not.toHaveBeenCalled();
			for (const fn of idles.values()) fn();
			expect(idle).toHaveBeenCalledOnce();
			frames.clear();
			idles.clear();
			s.timeout(vi.fn(), 'frame');
			s.timeout(vi.fn(), 'idle');
			s.close();
			expect([frames.size, idles.size]).toEqual([0, 0]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('every repeats until the scope closes', async () => {
		const s = scope();
		let n = 0;
		s.every(() => n++, 5);
		await wait(40);
		s.close();
		const at_close = n;
		expect(at_close).toBeGreaterThanOrEqual(2);
		await wait(30);
		expect(n).toBe(at_close);
	});

	it('a fired timeout lets go of itself: a long-lived scope does not pile them up', async () => {
		const s = scope();
		for (let i = 0; i < 50; i++) s.timeout(() => {}, 0);
		await wait(20);
		const held = (s as unknown as { _held: Set<unknown> | null })._held;
		expect(held?.size ?? 0).toBe(0);
		s.close();
	});

	it('refuses a time a timer cannot hold', () => {
		const s = scope();
		for (const ms of [-1, Number.NaN, Infinity, 2 ** 31])
			expect(() => s.timeout(() => {}, ms)).toThrow(/machine_bad_time/);
		expect(() => s.every(() => {}, -5)).toThrow(/every\(\) was given -5/);
		s.close();
	});

	it('a closed scope sets no timer', async () => {
		const s = scope();
		s.close();
		const fn = vi.fn();
		s.timeout(fn, 0)();
		s.every(fn, 1)();
		await wait(20);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('watch and adopt', () => {
	it('disconnects an observer on close (at once on a closed scope)', () => {
		const s = scope();
		const observer = { disconnect: vi.fn() };
		expect(s.watch(observer)).toBe(observer);
		expect(observer.disconnect).not.toHaveBeenCalled();
		s.close();
		expect(observer.disconnect).toHaveBeenCalledOnce();
		const late = { disconnect: vi.fn() };
		s.watch(late);
		expect(late.disconnect).toHaveBeenCalledOnce();
	});

	it.runIf(in_browser)('a real MutationObserver stops hearing changes after close', async () => {
		const s = scope();
		const el = document.createElement('div');
		const heard = vi.fn();
		s.watch(new MutationObserver(heard)).observe(el, { attributes: true });
		el.setAttribute('a', '1');
		await macrotask();
		expect(heard).toHaveBeenCalledOnce();
		s.close();
		el.setAttribute('a', '2');
		await macrotask();
		expect(heard).toHaveBeenCalledOnce();
	});

	it('adopts what disposes itself, sync or async', async () => {
		const s = scope();
		const sync = { [DISPOSE]: vi.fn() };
		let done = false;
		const later = {
			[ASYNC_DISPOSE]: vi.fn(async () => {
				await wait(5);
				done = true;
			})
		};
		expect(s.adopt(sync)).toBe(sync);
		s.adopt(later);
		await s[ASYNC_DISPOSE]();
		expect(sync[DISPOSE]).toHaveBeenCalledOnce();
		expect(done).toBe(true);
	});

	it('`await using` whose cleanup throws still waits for the async disposals, then throws both together', async () => {
		const s = scope();
		let done = false;
		s.adopt({
			[ASYNC_DISPOSE]: async () => {
				await wait(5);
				done = true;
				throw new Error('async broke');
			}
		});
		s.defer(() => {
			throw new Error('sync broke');
		});
		const error = await s[ASYNC_DISPOSE]().then(
			() => null,
			(e: unknown) => e
		);
		expect(done).toBe(true);
		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors.map((e: Error) => e.message).sort()).toEqual([
			'async broke',
			'sync broke'
		]);
	});

	it('a task whose work closes its own scope and then fails is STALE, its failure never unhandled', async () => {
		const unhandled = vi.fn();
		const on_node = typeof process !== 'undefined' && typeof process.on === 'function';
		if (on_node) process.on('unhandledRejection', unhandled);
		else window.addEventListener('unhandledrejection', unhandled);
		try {
			const s = scope();
			const out = s.task(() => {
				s.close();
				return Promise.reject(new Error('failed after closing'));
			});
			expect(await out).toBe(STALE);
			await wait(20);
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			if (on_node) process.off('unhandledRejection', unhandled);
			else window.removeEventListener('unhandledrejection', unhandled);
		}
	});

	it('`await using` gets the errors of an async disposal; a plain close reports them', async () => {
		const failing = () => ({
			[ASYNC_DISPOSE]: async () => {
				throw new Error('could not close');
			}
		});
		const s = scope();
		s.adopt(failing());
		await expect(s[ASYNC_DISPOSE]()).rejects.toThrow('could not close');

		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const plain = scope();
		plain.adopt(failing());
		plain.close();
		await macrotask();
		expect(error).toHaveBeenCalledOnce();
		expect(String(error.mock.calls[0][0])).toContain('machine_dispose_failed');
		error.mockRestore();
	});

	it('`await using` throws what a cleanup threw', async () => {
		const s = scope();
		s.defer(() => {
			throw new Error('cleanup broke');
		});
		await expect(s[ASYNC_DISPOSE]()).rejects.toThrow('cleanup broke');
	});

	it('an async disposal adopted by a cleanup of the close goes with the close: `await using` gets its error', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const s = scope();
			s.defer(() => {
				s.adopt({ [ASYNC_DISPOSE]: () => Promise.reject(new Error('late in the close')) });
			});
			await expect(s[ASYNC_DISPOSE]()).rejects.toThrow('late in the close');
			await macrotask();
			expect(error).not.toHaveBeenCalled();
		} finally {
			error.mockRestore();
		}
	});

	it('refuses what cannot dispose itself', () => {
		const s = scope();
		expect(() => s.adopt({} as Disposable)).toThrow(/machine_not_disposable/);
		s.close();
	});

	it('disposes at once on a closed scope', () => {
		const s = scope();
		s.close();
		const d = { [DISPOSE]: vi.fn() };
		s.adopt(d);
		expect(d[DISPOSE]).toHaveBeenCalledOnce();
	});

	it('an async disposal adopted by a closed scope runs at once, is said when it fails, and is not kept (#347)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const unhandled = vi.fn();
		const on_node = typeof process !== 'undefined' && typeof process.on === 'function';
		if (on_node) process.on('unhandledRejection', unhandled);
		else window.addEventListener('unhandledrejection', unhandled);
		try {
			const s = scope();
			s.close();
			// (a stopped machine's scope is the one closed scope every stopped machine shares)
			const m = machine<{ on: {} }>()({ name: 'gone', initial: 'on', steps: { on: [] } }).create();
			m.stop();
			const shared = m.scope as unknown as { _settling: unknown[] | null };
			const before = shared._settling?.length ?? 0;
			const failing = () => ({
				[ASYNC_DISPOSE]: vi.fn(() => Promise.reject(new Error('late')))
			});
			const a = failing();
			const b = failing();
			s.adopt(a);
			m.scope.adopt(b);
			expect(a[ASYNC_DISPOSE]).toHaveBeenCalledOnce();
			expect(b[ASYNC_DISPOSE]).toHaveBeenCalledOnce();
			await wait(20);
			expect(unhandled).not.toHaveBeenCalled();
			expect(error).toHaveBeenCalledTimes(2);
			expect(String(error.mock.calls[0][0])).toContain('machine_dispose_failed');
			expect(shared._settling?.length ?? 0).toBe(before);
		} finally {
			if (on_node) process.off('unhandledRejection', unhandled);
			else window.removeEventListener('unhandledrejection', unhandled);
			error.mockRestore();
		}
	});
});

describe('task', () => {
	it('gives the answer while the scope is open', async () => {
		const s = scope();
		await expect(s.task(async () => 'html')).resolves.toBe('html');
		await expect(s.task(() => 7)).resolves.toBe(7);
	});

	it('settles with STALE the moment the scope closes, even when work never finishes', async () => {
		const s = scope();
		let signal!: AbortSignal;
		const out = s.task((sig) => ((signal = sig), new Promise<string>(() => {})));
		s.close();
		expect(signal.aborted).toBe(true);
		await expect(out).resolves.toBe(STALE);
	});

	it('work that closes its own scope before it returns still settles with STALE (#349)', async () => {
		const s = scope();
		const out = s.task(() => {
			s.close();
			return new Promise<string>(() => {}); // (ignores its signal: never settles)
		});
		const hang = new Promise((r) => setTimeout(() => r('hangs'), 50));
		await expect(Promise.race([out, hang])).resolves.toBe(STALE);

		// a machine's visit: the work moves the machine out of the state it runs in
		const m = machine<{ a: {}; b: {} }>()({
			name: 'self',
			initial: 'a',
			steps: { a: ['b'], b: [] }
		}).create();
		const moved = m.scope.task(() => (m.go('b'), new Promise<never>(() => {})));
		await expect(Promise.race([moved, hang])).resolves.toBe(STALE);
	});

	it('an answer or a failure after the scope closed is STALE', async () => {
		const s = scope();
		let finish!: (v: string) => void;
		let fail!: (e: unknown) => void;
		const a = s.task(() => new Promise<string>((r) => (finish = r)));
		const b = s.task(() => new Promise<string>((_, r) => (fail = r)));
		s.close();
		finish('late');
		fail(new Error('late'));
		await expect(a).resolves.toBe(STALE);
		await expect(b).resolves.toBe(STALE);
	});

	it('a failure while open rejects; a throw at once too', async () => {
		const s = scope();
		await expect(s.task(async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
		await expect(
			s.task(() => {
				throw new Error('sync');
			})
		).rejects.toThrow('sync');
	});

	it('a closed scope does not run work', async () => {
		const s = scope();
		s.close();
		const work = vi.fn(() => 1);
		await expect(s.task(work)).resolves.toBe(STALE);
		expect(work).not.toHaveBeenCalled();
	});
});

describe('a machine visit is a scope', () => {
	const door = machine<{ shut: {}; open: {}; gone: {} }>()({
		name: 'door',
		initial: 'shut',
		steps: { shut: ['open', 'gone'], open: ['shut', 'open'], gone: [] }
	});

	it('one scope per visit: the same through the visit, closed by leaving, a new one next time', () => {
		const m = door.create();
		const first = m.scope;
		expect(m.scope).toBe(first);
		m.go('open');
		expect(first.closed).toBe(true);
		const second = m.scope;
		expect(second).not.toBe(first);
		expect(second.closed).toBe(false);
		m.go('open'); // the same state again is a new visit
		expect(second.closed).toBe(true);
		expect(m.scope).not.toBe(second);
	});

	it('what a visit holds is let go when the machine leaves: listeners, timers, observers', async () => {
		const m = door.create();
		const target = new EventTarget();
		const heard = vi.fn();
		const timed = vi.fn();
		const observer = { disconnect: vi.fn() };
		m.scope.on(target, 'ping', heard);
		m.scope.timeout(timed, 5);
		m.scope.watch(observer);
		m.go('open');
		target.dispatchEvent(new Event('ping'));
		await wait(20);
		expect(heard).not.toHaveBeenCalled();
		expect(timed).not.toHaveBeenCalled();
		expect(observer.disconnect).toHaveBeenCalledOnce();
	});

	it('a stopped machine’s scope is closed: work does not run, cleanups run at once', async () => {
		const m = door.create();
		const s = m.scope;
		m.stop();
		expect(s.closed).toBe(true);
		expect(m.scope.closed).toBe(true);
		const cleanup = vi.fn();
		m.scope.defer(cleanup);
		expect(cleanup).toHaveBeenCalledOnce();
		await expect(m.scope.task(() => 1)).resolves.toBe(STALE);
	});

	it('a move that throws from its cleanups names the machine', () => {
		const m = door.create();
		m.scope.defer(() => {
			throw new Error('a');
		});
		m.scope.defer(() => {
			throw new Error('b');
		});
		expect(() => m.go('open')).toThrow('[ogygia] machine door: 2 cleanups threw');
		expect(m.now.kind).toBe('open');
	});

	it('a visit nothing hangs work on makes no scope', () => {
		const m = door.create();
		m.go('open');
		m.go('shut');
		expect((m as unknown as { _scope: unknown })._scope).toBeNull();
	});
});
