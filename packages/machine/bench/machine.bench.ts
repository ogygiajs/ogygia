// Machine moves, as the runtime and the server make them: a crowd of machines (one per region on a
// page, one per request on a server) each walked around its lifecycle, with and without data, with
// the work they own (their visit's scope: tasks, cleanups; waits), and the others (flights, scope,
// lock).
import { bench } from '@bench/heisenbench/bench';
import {
	flights,
	lock,
	machine,
	mailbox,
	observe,
	outbox,
	policy,
	queue,
	scope,
	stage,
	STALE,
	world,
	type LockToken,
	type Scope,
	type Stage
} from '../src/index.ts';
import { KEYS_KEPT } from '../src/world.ts';
import { MACHINE_ERRORS, machine_error, report } from '../src/messages.ts';
import { backoffAfter } from '../src/policy.ts';

/** A lazy chunk's one more try, at once (core's `download` policy). */
const ONE_MORE_TRY = policy({ attempts: 2, backoff: 0, jitter: 0, deadline: Infinity });

const hole = machine<{
	idle: {};
	fetching: { attempt: number };
	applying: {};
	answered: {};
	failed: { attempt: number };
	gone: {};
}>()({
	name: 'hole',
	initial: 'idle',
	steps: {
		idle: ['fetching', 'gone'],
		fetching: ['applying', 'failed', 'idle'],
		applying: ['answered', 'failed'],
		answered: ['fetching'],
		failed: ['fetching', 'gone'],
		gone: []
	}
});

type Hole = ReturnType<typeof hole.create>;

function crowd(n: number): Hole[] {
	return Array.from({ length: n }, () => hole.create());
}

bench(
	'machine: 200 machines walked through a fetch each',
	({ machines }) => {
		let moved = 0;
		for (const m of machines) {
			if (m.move('idle', 'fetching', { attempt: 1 })) moved++;
			if (m.move('fetching', 'applying')) moved++;
			if (m.move('applying', 'answered')) moved++;
			const s = m.now;
			if (s.kind === 'answered' && m.go('fetching', { attempt: 2 })) moved++;
			if (m.go('idle')) moved++;
		}
		return moved;
	},
	{
		setup: () => ({ machines: crowd(200) }),
		scale: (_ctx, k) => ({ machines: crowd(200 * k) })
	}
);

bench(
	'machine: moves that lost the race (refused quietly)',
	({ machines }) => {
		let refused = 0;
		for (const m of machines) {
			if (!m.move('fetching', 'applying')) refused++;
			if (!m.move('answered', 'fetching', { attempt: 1 })) refused++;
		}
		return refused;
	},
	{
		setup: () => ({ machines: crowd(200) }),
		scale: (_ctx, k) => ({ machines: crowd(200 * k) })
	}
);

bench('machine: create a machine per region', ({ n }) => crowd(n).length, {
	setup: () => ({ n: 200 }),
	scale: (_ctx, k) => ({ n: 200 * k })
});

/** A chain of `n` states, each stepping to the next and back to the first: a definition to grow. */
function chain_steps(n: number): Record<string, string[]> {
	const steps: Record<string, string[]> = {};
	for (let i = 0; i < n; i++) steps[`s${i}`] = i + 1 < n ? [`s${i + 1}`, 's0'] : ['s0'];
	return steps;
}

bench(
	'machine: define a machine of n states (checked, linked)',
	({ steps }) => {
		const def = machine<Record<string, {}>>()({ name: 'chain', initial: 's0', steps } as never) as {
			create(): { go(to: string): boolean };
		};
		const m = def.create();
		let moved = 0;
		for (const kind of Object.keys(steps).slice(1)) if (m.go(kind)) moved++;
		return moved;
	},
	{
		setup: () => ({ steps: chain_steps(40) }),
		scale: (_ctx, k) => ({ steps: chain_steps(40 * k) })
	}
);

bench(
	'machine: a task per visit (answered, cut off by a move, failed after leaving)',
	async ({ machines }) => {
		const out: Promise<unknown>[] = [];
		for (let i = 0; i < machines.length; i++) {
			const m = machines[i];
			m.go('fetching', { attempt: 1 });
			if (i % 3 === 0) out.push(m.scope.task(async () => 'html'));
			else if (i % 3 === 1) {
				out.push(m.scope.task(() => new Promise<string>(() => {})));
				m.go('idle'); // the visit ends: settles STALE at once
			} else {
				let fail!: (e: unknown) => void;
				out.push(m.scope.task(() => new Promise((_, reject) => (fail = reject))));
				m.go('idle');
				fail(new Error('after it left'));
			}
		}
		const settled = await Promise.all(out);
		return settled.filter((v) => v === STALE).length;
	},
	{
		setup: () => ({ machines: crowd(120) }),
		scale: (_ctx, k) => ({ machines: crowd(120 * k) })
	}
);

bench(
	'machine: cleanups per visit (run once, newest first, a throwing one reported)',
	({ machines }) => {
		let ran = 0;
		let thrown = 0;
		for (let i = 0; i < machines.length; i++) {
			const m = machines[i];
			m.scope.defer(() => ran++);
			m.scope.defer(() => ran++);
			if (i % 10 === 0)
				m.scope.defer(() => {
					throw new Error('cleanup');
				});
			try {
				m.go('fetching', { attempt: 1 });
			} catch {
				thrown++;
			}
			m.go('idle');
		}
		return ran + thrown;
	},
	{
		setup: () => ({ machines: crowd(200) }),
		scale: (_ctx, k) => ({ machines: crowd(200 * k) })
	}
);

bench(
	'machine: waits (reached, out of reach, settled by stop)',
	async ({ machines }) => {
		const out: Promise<unknown>[] = [];
		for (let i = 0; i < machines.length; i++) {
			const m = machines[i];
			out.push(m.wait('answered'), m.wait('idle'));
			if (i % 3 === 0) {
				m.go('fetching', { attempt: 1 });
				m.go('applying');
				m.go('answered');
			} else if (i % 3 === 1) m.go('gone');
			else m.stop();
		}
		const settled = await Promise.all(out);
		return settled.filter((v) => v === STALE).length;
	},
	{
		setup: () => ({ machines: crowd(150) }),
		scale: (_ctx, k) => ({ machines: crowd(150 * k) })
	}
);

bench(
	'machine: stop with tasks and cleanups in flight',
	({ machines }) => {
		let ran = 0;
		for (const m of machines) {
			m.go('fetching', { attempt: 1 });
			void m.scope.task(() => new Promise(() => {}));
			m.scope.defer(() => ran++);
			m.stop();
			m.stop();
			m.scope.defer(() => ran++); // a stopped machine runs it at once
		}
		return ran;
	},
	{
		setup: () => ({ machines: crowd(200) }),
		scale: (_ctx, k) => ({ machines: crowd(200 * k) })
	}
);

bench(
	'machine: moves while observed, then unobserved',
	({ machines }) => {
		let heard = 0;
		const off = observe(() => heard++);
		const off2 = observe(() => heard++);
		for (const m of machines) {
			m.go('fetching', { attempt: 1 });
			m.go('idle');
		}
		off();
		off2();
		for (const m of machines) m.go('fetching', { attempt: 2 });
		return heard;
	},
	{
		setup: () => ({ machines: crowd(200) }),
		scale: (_ctx, k) => ({ machines: crowd(200 * k) })
	}
);

bench(
	'machine: moves the steps do not allow (refused, said once)',
	({ machines }) => {
		const warn = console.warn;
		console.warn = () => {};
		let refused = 0;
		try {
			for (const m of machines) {
				const untyped = m as unknown as { go(to: string): boolean };
				try {
					if (!untyped.go('answered')) refused++;
				} catch {
					refused++; // dev throws
				}
			}
		} finally {
			console.warn = warn;
		}
		return refused;
	},
	{
		setup: () => ({ machines: crowd(200) }),
		scale: (_ctx, k) => ({ machines: crowd(200 * k) })
	}
);

bench('machine: every message, worded', () => {
	let length = 0;
	const table = MACHINE_ERRORS as unknown as Record<
		string,
		{ text: (a: Record<string, string>) => string; details: () => string }
	>;
	const args = {
		name: 'hole',
		from: 'idle',
		to: 'kept',
		state: 'kept',
		where: 'initial',
		initial: 'idle',
		option: 'retries',
		value: '-1',
		problem: 'its ms is not a time',
		ms: 'NaN',
		rule: 'a whole number of 0 or more',
		owner: 'scope'
	};
	for (const code in table) length += table[code].text(args).length + table[code].details().length;
	const error = console.error;
	console.error = () => void length++;
	try {
		report('machine_observer_failed', { name: 'hole' }, new Error('observer'));
		report('machine_timeout_not_a_time', { name: 'hole', state: 'fetching', ms: 'NaN' });
	} finally {
		console.error = error;
	}
	length += machine_error('machine_illegal_move', { name: 'hole', from: 'idle', to: 'kept' })
		.message.length;
	return length;
});

bench(
	'flights: one key (a lazy chunk): loads shared, failures not kept, retried',
	async ({ n }) => {
		let loads = 0;
		const out: Promise<unknown>[] = [];
		for (let i = 0; i < n; i++) {
			let calls = 0;
			const chunk = flights({
				run: async () => {
					loads++;
					if (calls++ === 0 && i % 2 === 0) throw new Error('blip');
					return i;
				},
				...(i % 4 === 0 ? { retry: ONE_MORE_TRY } : {})
			});
			out.push(
				chunk.get().catch(() => chunk.get()),
				chunk.get().catch(() => -1)
			);
		}
		await Promise.all(out);
		return loads;
	},
	{ setup: () => ({ n: 150 }), scale: (_ctx, k) => ({ n: 150 * k }) }
);

bench(
	'flights: a kept answer read by every island (the hot path)',
	({ chunk, n }) => {
		let got = 0;
		for (let i = 0; i < n; i++) if (chunk.get() !== null) got++;
		return got;
	},
	{
		setup: async () => {
			const chunk = flights({ run: async () => ({ hydrate: 1 }) });
			await chunk.get();
			return { chunk, n: 500 };
		},
		scale: (ctx, k) => ({ chunk: ctx.chunk, n: 500 * k })
	}
);

bench(
	'flights: speculative warms joined by visible and user loads (priority raises, heard by the run)',
	async ({ n }) => {
		let heard = 0;
		const landed: (() => void)[] = [];
		const chunks = flights({
			name: 'chunks',
			keep: 0,
			run: (url: string, _signal, flight) => {
				flight.onRaise(() => heard++);
				return new Promise<string>((r) => landed.push(() => r(url)));
			}
		});
		const out: Promise<unknown>[] = [];
		for (let i = 0; i < n; i++) {
			const url = `/chunk/${i % 50}`;
			// a guess, then the joins that need it more (and some that need it less)
			out.push(chunks.get(url, { priority: i % 4 }));
		}
		for (const land of landed) land();
		await Promise.all(out);
		return heard;
	},
	{ setup: () => ({ n: 400 }), scale: (_ctx, k) => ({ n: 400 * k }) }
);

bench(
	'queue: renders through four places, some past their deadline, some cancelled, each released as it ends',
	async ({ n }) => {
		let clock = 0;
		let started = 0;
		let stale = 0;
		const q = queue<number>({
			max: 4,
			now: () => clock,
			start: (job, place) => {
				started++;
				void Promise.resolve().then(() => {
					clock++;
					place.release(); // the render ends
				});
				void job;
			},
			stale: () => void stale++
		});
		for (let i = 0; i < n; i++) {
			q.push(i, i % 7 === 0 ? clock + 20 : undefined);
			if (i % 11 === 0) q.cancel(i);
		}
		while (q.waiting) await Promise.resolve();
		return started + stale;
	},
	{ setup: () => ({ n: 400 }), scale: (_ctx, k) => ({ n: 400 * k }) }
);

bench(
	'flights: keyed pages (joins, callers that leave, drops, fresh, keep, max and weigh)',
	async ({ n }) => {
		const pages = flights({
			name: 'pages',
			run: async (href: string, signal: AbortSignal) => {
				await Promise.resolve();
				if (signal.aborted) throw signal.reason;
				if (href.endsWith('7')) throw new Error('blip');
				return { html: 'x'.repeat(href.length * 10), cacheable: !href.endsWith('3') };
			},
			keep: (page) => (page.cacheable ? 60_000 : 0),
			max: 2_000,
			weigh: (page) => page.html.length
		});
		const out: Promise<unknown>[] = [];
		for (let i = 0; i < n; i++) {
			const href = `/page/${i % 40}`;
			const ctl = new AbortController();
			out.push(pages.get(href).catch(() => null));
			out.push(pages.get(href, { signal: ctl.signal }).catch(() => null));
			if (i % 5 === 0) ctl.abort();
			if (i % 11 === 0) pages.drop(href);
			if (i % 13 === 0) out.push(pages.get(href, { fresh: true }).catch(() => null));
			if (i % 17 === 0) pages.drop((key) => key.endsWith('1'));
			if (i % 4 === 0) pages.peek(href);
		}
		const settled = await Promise.all(out);
		// revalidations of what is kept now: each one beside its kept answer
		const again: Promise<unknown>[] = [];
		for (let i = 0; i < 40; i += 2) again.push(pages.get(`/page/${i}`, { fresh: true }));
		await Promise.allSettled(again);
		pages[Symbol.dispose]();
		return settled.filter((v) => v === STALE).length;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

bench(
	'scope: listeners, timers, observers, children and cleanups held, then released by one close',
	({ n }) => {
		const target = new EventTarget();
		// a Node-style emitter (on / off), as a child process or a socket is one
		const listeners = new Set<() => void>();
		const emitter = {
			on: (_type: string, fn: () => void) => listeners.add(fn),
			off: (_type: string, fn: () => void) => listeners.delete(fn),
			emit: () => {
				for (const fn of listeners) fn();
			}
		};
		const root = scope();
		let heard = 0;
		const on_ping = () => heard++;
		for (let i = 0; i < n; i++) {
			const s = i % 3 === 0 ? root.child() : scope(root);
			s.on(target, 'ping', on_ping);
			if (i % 2 === 0) s.on(emitter, 'data', on_ping);
			const cancel = s.timeout(() => heard--, 60_000);
			if (i % 2 === 0) cancel();
			if (i % 5 === 0) s.every(() => heard--, 60_000);
			if (i % 7 === 0) s.timeout(() => heard--, i % 2 === 0 ? 'frame' : 'idle');
			s.watch({ disconnect: () => heard++ });
			s.defer(() => heard++);
			s.adopt({ [Symbol.dispose]: () => heard++ });
			if (i % 4 === 0) s.close();
		}
		target.dispatchEvent(new Event('ping'));
		emitter.emit();
		root.close();
		target.dispatchEvent(new Event('ping'));
		emitter.emit();
		return heard;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

type Frames = {
	requestAnimationFrame?: (fn: () => void) => number;
	cancelAnimationFrame?: (id: number) => void;
	requestIdleCallback?: (fn: () => void) => number;
	cancelIdleCallback?: (id: number) => void;
};

bench(
	'scope: `using` and `await using`, async disposals awaited or reported, frame and idle callbacks',
	async ({ n, frames }) => {
		const host = globalThis as Frames;
		// a page's frame and idle callbacks (node has neither: these stand in, as a browser's would)
		Object.assign(host, frames);
		const error = console.error;
		console.error = () => {};
		let done = 0;
		try {
			for (let i = 0; i < n; i++) {
				{
					using s = scope();
					s.defer(() => done++);
					if (s.closed) done--;
					const cancel = s.timeout(() => done++, i % 2 === 0 ? 'frame' : 'idle');
					if (i % 3 === 0) cancel();
				}
				await using later = scope();
				later.adopt({ [Symbol.asyncDispose]: async () => void done++ });
				if (i % 5 === 0) {
					const plain = scope();
					plain.adopt({
						[Symbol.asyncDispose]: () => Promise.reject(new Error('could not close'))
					});
					plain.close(); // nobody waits: reported
				}
			}
			await new Promise((r) => setTimeout(r, 0));
		} finally {
			console.error = error;
			delete host.requestAnimationFrame;
			delete host.cancelAnimationFrame;
			delete host.requestIdleCallback;
			delete host.cancelIdleCallback;
		}
		return done;
	},
	{
		setup: () => ({
			n: 100,
			frames: {
				requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0) as unknown as number,
				cancelAnimationFrame: (id: number) => clearTimeout(id),
				requestIdleCallback: (fn: () => void) => setTimeout(fn, 0) as unknown as number,
				cancelIdleCallback: (id: number) => clearTimeout(id)
			}
		}),
		scale: (ctx, k) => ({ ...ctx, n: 100 * k })
	}
);

bench(
	'scope: tasks answered, failed, and settled STALE by a close',
	async ({ n }) => {
		const out: Promise<unknown>[] = [];
		const scopes: Scope[] = [];
		for (let i = 0; i < n; i++) {
			const s = scope();
			scopes.push(s);
			if (i % 3 === 0) out.push(s.task(async () => i));
			else if (i % 3 === 1) out.push(s.task(() => Promise.reject(new Error('x'))).catch(() => -1));
			else out.push(s.task(() => new Promise(() => {})));
		}
		for (let i = 2; i < n; i += 3) scopes[i].close();
		const settled = await Promise.all(out);
		for (const s of scopes) s.close();
		return settled.filter((v) => v === STALE).length;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

bench(
	'lock: owners take, free, queue, abort and seize',
	async ({ n }) => {
		const l = lock();
		let granted = 0;
		const first = l.take() as LockToken;
		const waits: Promise<unknown>[] = [];
		const aborts: AbortController[] = [];
		for (let i = 0; i < n; i++) {
			const ctl = new AbortController();
			aborts.push(ctl);
			waits.push(
				l.acquire(ctl.signal).then(
					(t) => {
						granted++;
						if (l.held) l.free(t);
					},
					() => {}
				)
			);
		}
		for (let i = 0; i < n; i += 3) aborts[i].abort();
		const mine = l.seize();
		l.free(first); // refused: seized
		l.free(mine);
		await Promise.all(waits);
		const t = l.take();
		if (t !== null) l.free(t);
		return granted;
	},
	{ setup: () => ({ n: 150 }), scale: (_ctx, k) => ({ n: 150 * k }) }
);

bench(
	'mailbox: owners post, ask and wait; events queue behind waits; a long queue drains in one turn; a quarter close mid-wait',
	async ({ n }) => {
		let ran = 0;
		const asks: Promise<unknown>[] = [];
		for (let i = 0; i < n; i++) {
			const life = scope();
			const box = mailbox(life);
			// idle box: runs at once
			box.post(() => void ran++);
			// a handler that waits twice, letting queued events in each time
			asks.push(
				box.ask(async (turn) => {
					if ((await turn.wait(Promise.resolve(i))) === STALE) return;
					if ((await turn.wait([i, Promise.resolve(i)])) === STALE) return;
					ran++;
				})
			);
			// queued behind the wait, plus a run of re-entrant posts from one turn
			box.post(() => {
				for (let k = 0; k < 8; k++) box.post(() => void ran++);
			});
			// a wait from outside any turn, and one more ask
			asks.push(
				box.wait(Promise.resolve(i)),
				box.ask(() => ran++)
			);
			if (i % 4 === 0) queueMicrotask(() => life.close());
		}
		await Promise.all(asks);
		return ran;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

bench(
	'mailbox: a queued handler that throws is reported, and the box goes on',
	({ n }) => {
		const page = globalThis as { reportError?: (e: unknown) => void };
		const kept = page.reportError;
		const said = console.error;
		let heard = 0;
		page.reportError = () => void heard++;
		console.error = () => {};
		try {
			const box = mailbox(scope());
			box.post(() => {
				for (let i = 0; i < n; i++)
					box.post(() => {
						if (i % 2 === 0) throw new Error('queued');
					});
			});
		} finally {
			page.reportError = kept;
			console.error = said;
		}
		return heard;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

const timed = machine<{ idle: {}; fetching: { attempt: number }; failed: { attempt: number } }>()({
	name: 'timed',
	initial: 'idle',
	steps: { idle: ['fetching'], fetching: ['idle', 'failed'], failed: ['fetching'] },
	after: {
		fetching: { ms: 20, to: 'failed', data: (s) => ({ attempt: s.attempt }) },
		failed: { ms: (s) => s.attempt, to: 'fetching', data: (s) => ({ attempt: s.attempt + 1 }) }
	}
});

bench(
	'machine: states that end on their own (some left first, some timed out and retried)',
	async ({ n }) => {
		const machines = Array.from({ length: n }, () => timed.create());
		for (let i = 0; i < n; i++) machines[i].go('fetching', { attempt: 1 });
		for (let i = 0; i < n; i += 2) machines[i].go('idle'); // half leave before their time
		await new Promise((r) => setTimeout(r, 30)); // the rest time out, then retry
		let retried = 0;
		for (const m of machines) {
			if (m.now.kind !== 'idle') retried++;
			m.stop();
		}
		return retried;
	},
	{ setup: () => ({ n: 100 }), scale: (_ctx, k) => ({ n: 100 * k }) }
);

bench(
	'machine: a definition of n states as data (graph and the paths that take every step)',
	({ steps }) => {
		const def = machine<Record<string, {}>>()({ name: 'chain', initial: 's0', steps } as never);
		return def.graph().states.length + def.paths().length;
	},
	{
		setup: () => ({ steps: chain_steps(40) }),
		scale: (_ctx, k) => ({ steps: chain_steps(40 * k) })
	}
);

bench(
	'outbox: sends put, joined by id, tried again once, some in order, a few given up',
	async ({ n }) => {
		const quick = policy({ attempts: 2, backoff: 0, jitter: 0, deadline: 1000 });
		const failed_once = new Set<number>();
		const send = (i: number) => {
			if (i % 5 === 0 && !failed_once.has(i)) {
				failed_once.add(i);
				throw new Error('blip');
			}
			if (i % 17 === 0) return Promise.reject(new Error('down'));
		};
		const kept: Promise<unknown>[] = [];
		const box = outbox({
			send,
			id: (i: number) => i,
			retry: quick,
			giveUp: () => {},
			waitUntil: (w) => kept.push(w)
		});
		const ordered = outbox({ send, retry: quick, inOrder: true, giveUp: () => {} });
		const out: Promise<boolean>[] = [];
		for (let i = 0; i < n; i++) {
			out.push(box.put(i), box.put(i)); // the second joins the first
			if (i % 4 === 0) out.push(ordered.put(i + 1));
		}
		const done = await Promise.all(out);
		return done.filter(Boolean).length + kept.length;
	},
	{ setup: () => ({ n: 150 }), scale: (_ctx, k) => ({ n: 150 * k }) }
);

bench(
	'outbox: retry policies made and their waits worked out',
	({ n }) => {
		let total = 0;
		for (let i = 0; i < n; i++) {
			const p = policy({
				attempts: 1 + (i % 6),
				backoff: i % 2 ? 50 : [10, 100, 1000],
				jitter: 0.2
			});
			for (let t = 1; t < p.attempts; t++) total += backoffAfter(p, t, 0.5);
		}
		return total;
	},
	{ setup: () => ({ n: 300 }), scale: (_ctx, k) => ({ n: 300 * k }) }
);

bench(
	'stage: changes built and committed, some owners left first, a few commits that throw',
	async ({ n }) => {
		const said = console.error;
		console.error = () => {};
		let live = 0;
		let given_back = 0;
		const owners: Scope[] = [];
		const stages: Stage<number>[] = [];
		for (let i = 0; i < n; i++) {
			const owner = scope();
			owners.push(owner);
			stages.push(
				stage(owner, {
					name: 'page',
					build: async ({ discard }) => {
						discard(() => given_back++);
						if (i % 7 === 0)
							discard(() => {
								throw new Error('stuck');
							});
						await Promise.resolve();
						return i;
					},
					commit: (built, undo) => {
						live += built;
						undo(() => (live -= built));
						if (built % 11 === 0) throw new Error('half way');
					}
				})
			);
			if (i % 3 === 0) owner.close(); // left before it was built
		}
		for (let i = 0; i < n; i++) {
			if ((await stages[i].ready) === STALE) continue;
			try {
				stages[i].commit();
			} catch {
				// ok: counted in `given_back`
			}
		}
		for (const owner of owners) owner.close();
		console.error = said;
		return live + given_back;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

bench(
	'world: stamps taken and judged, whole and keyed moves, past the keys it keeps',
	({ n }) => {
		const page = world();
		const tags = world.keyed<string>();
		let fresh = 0;
		for (let i = 0; i < n; i++) {
			const a = page.stamp();
			const b = tags.stamp();
			if (i % 7 === 0) page.bump();
			if (i % 3 === 0) tags.bump([`t${i % 50}`, 'all']);
			if (i % 97 === 0) tags.bump();
			if (i % 13 === 0) tags.bump([]);
			if (page.fresh(a)) fresh++;
			if (tags.fresh(b, [`t${i % 60}`])) fresh++;
			if (tags.fresh(b)) fresh++;
		}
		// more keys than it keeps: the oldest fold into the floor
		const many = world.keyed<number>();
		const before = many.stamp();
		for (let i = 0; i <= KEYS_KEPT; i++) many.bump([i]);
		if (many.fresh(before, [n])) fresh++;
		return fresh;
	},
	{ setup: () => ({ n: 600 }), scale: (_ctx, k) => ({ n: 600 * k }) }
);

bench(
	'flights in a world: keyed moves drop what they touch, answers made stale on the way',
	async ({ n }) => {
		const tags = world.keyed<string>();
		const docs = flights({
			name: 'docs',
			world: tags,
			touches: (doc: { tags: string[] }) => doc.tags,
			run: async (path: string) => {
				await Promise.resolve();
				return { tags: [`p:${path}`, `s:${path.length % 3}`] };
			}
		});
		const whole = world();
		const pages = flights({ world: whole, run: async (href: string) => href });
		const out: Promise<unknown>[] = [];
		for (let i = 0; i < n; i++) {
			const path = `/doc/${i % 30}`;
			out.push(docs.get(path), pages.get(path));
			if (i % 5 === 0) tags.bump([`s:${i % 3}`]);
			if (i % 9 === 0) tags.bump([`p:${path}`]);
			if (i % 23 === 0) whole.bump();
			if (i % 31 === 0) out.push(docs.get(path, { fresh: true }));
		}
		const settled = await Promise.all(out);
		docs[Symbol.dispose]();
		pages[Symbol.dispose]();
		return settled.filter((v) => v === STALE).length;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);
