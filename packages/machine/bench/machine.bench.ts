// Machine moves, as the runtime and the server make them: a crowd of machines (one per region on a
// page, one per request on a server) each walked around its lifecycle, with and without data, with
// the work they own (tasks, cleanups, waits), and the two helpers (once, lock).
import { bench } from '@bench/heisenbench/bench';
import { lock, machine, observe, once, STALE, type LockToken } from '../src/index.ts';
import { MACHINE_ERRORS, machine_error } from '../src/messages.ts';

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
	for (let i = 0; i < n; i++) steps['s' + i] = i + 1 < n ? ['s' + (i + 1), 's0'] : ['s0'];
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
			if (i % 3 === 0) out.push(m.task(async () => 'html'));
			else if (i % 3 === 1) {
				out.push(m.task(() => new Promise<string>(() => {})));
				m.go('idle'); // the visit ends: settles STALE at once
			} else {
				let fail!: (e: unknown) => void;
				out.push(m.task(() => new Promise((_, reject) => (fail = reject))));
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
			m.onLeave(() => ran++);
			m.onLeave(() => ran++);
			if (i % 10 === 0)
				m.onLeave(() => {
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
			void m.task(() => new Promise(() => {}));
			m.onLeave(() => ran++);
			m.stop();
			m.stop();
			m.onLeave(() => ran++); // a stopped machine runs it at once
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
		value: '-1'
	};
	for (const code in table) length += table[code].text(args).length + table[code].details().length;
	length += machine_error('machine_illegal_move', { name: 'hole', from: 'idle', to: 'kept' })
		.message.length;
	return length;
});

bench(
	'once: loaders shared, failures not kept, retried',
	async ({ n }) => {
		let loads = 0;
		const out: Promise<unknown>[] = [];
		for (let i = 0; i < n; i++) {
			let calls = 0;
			const get = once(
				async () => {
					loads++;
					if (calls++ === 0 && i % 2 === 0) throw new Error('blip');
					return i;
				},
				{ retries: i % 4 === 0 ? 1 : 0 }
			);
			out.push(
				get().catch(() => get()),
				get().catch(() => -1)
			);
		}
		await Promise.all(out);
		return loads;
	},
	{ setup: () => ({ n: 150 }), scale: (_ctx, k) => ({ n: 150 * k }) }
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
