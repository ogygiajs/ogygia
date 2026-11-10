/**
 * Work that waits for its turn: a job starts only when there is room for it, the most urgent first.
 *
 *   const downloads = queue<Download>({
 *     name: 'downloads',
 *     max: 3,                                   // at most three hold a place at once
 *     holds: (priority) => priority < 2,        // urgent ones start past the cap
 *     admit: (d, priority) => gate_open || priority >= 2,
 *     budget: 16,                               // a drain starts jobs for 16 ms, then pauses
 *     pause: (resume) => void yield_task().then(resume)
 *   });
 *   const s = await downloads.add(d, { priority: () => class_of(d), flight, owner });
 *   if (s === STALE) return;                    // its owner closed, or its deadline came
 *   try { await fetch(d.url); } finally { s.release(); }
 *
 * - A job starts when its queue lets it: `admit` says yes, and, if it `holds` a place, fewer than
 *   `max` do. `add` resolves then, with a `release` to call once the work is done (once: a second
 *   call does nothing). A release hands its place to the next job in the same step: a job added
 *   meanwhile queues behind it instead of starting beside it.
 * - `push` queues a job with no promise: the queue's `start` and `stale` hear it instead.
 * - `start(job, started)`, when given, starts each job in the drain's own step. A promise it
 *   returns is waited for before the next start: the job's own start-up. One that throws is
 *   reported (machine_queue_start_failed) and the drain goes on.
 * - The most urgent starts first: the highest `priority`, then the order added. A getter is read
 *   again at each drain, and after a job's start ran. A job that serves a flight (`flight`) is at
 *   least at the flight's priority, and a caller raising the flight drains the queue: the job moves
 *   up while it waits.
 * - `drain()` looks again: something `admit` or a priority getter reads changed.
 * - `budget` (ms): a drain gives the thread back after starting jobs for this long (`pause`), and
 *   goes on when `pause` calls it back. `deferred`: a drain begins with a pause, never in the step
 *   that added.
 * - `deadline` (by `now`): a job still waiting then settles `STALE` and never starts (one whose
 *   deadline came is passed over even before its timer runs).
 * - A job's `owner` closing settles it `STALE` while it waits, and gives its place back once it
 *   started. The queue's `owner` closing settles every waiting job `STALE`, and any added after.
 *
 * One drain runs at a time: one asked for while it runs goes round once more when it is done.
 */
import { machine } from './machine.ts';
import { machine_error, report_thrown } from './messages.ts';
import type { InFlight } from './flights.ts';
import { MAX_TIMEOUT_MS, scope, type Scope } from './scope.ts';
import { STALE, type Stale } from './stale.ts';

export interface QueueOptions<J> {
	/** Names the queue in messages and in `graph()`. */
	name?: string;
	/** The most jobs holding a place at once (no cap when left out). */
	max?: number;
	/** Whether a job holds a place (counts toward `max`), read with its priority as it starts. Every
	 *  job holds one when left out. */
	holds?: (priority: number, job: J) => boolean;
	/** Whether a waiting job may start now. One it refuses keeps its place; `drain()` looks again. */
	admit?: (job: J, priority: number) => boolean;
	/** Starts a job, in the drain's step. A promise it returns is waited for before the next start. */
	start?: (job: J, started: Started) => void | PromiseLike<unknown>;
	/** Hears a job that settles `STALE` (its owner closed, or its deadline came) before it started. */
	stale?: (job: J) => void;
	/** How long (ms) a drain starts jobs before it gives the thread back with `pause`. */
	budget?: number;
	/** Gives the thread back: calls `resume` in a new task. Needed by `budget` and `deferred`. */
	pause?: (resume: () => void) => void;
	/** A drain begins with a `pause`, never in the step that added. */
	deferred?: boolean;
	/** The clock for `budget` and `deadline` (ms): `performance.now()` when left out. */
	now?: () => number;
	/** The queue's owner: closing it settles every waiting job `STALE` (and any added after). */
	owner?: Scope;
}

export interface AddOptions {
	/** Higher starts first (0 when left out). A getter is read again at each drain. */
	priority?: number | (() => number);
	/** The shared flight the job serves: the job is at least at its priority, and a raise drains. */
	flight?: InFlight;
	/** When (by the queue's `now`) a job still waiting gives up: it settles `STALE`. */
	deadline?: number;
	/** Closing it settles a waiting job `STALE`, and gives a started one's place back. */
	owner?: Scope;
}

/** A started job: `release` gives its place back (once). `priority` is the one it started at. */
export interface Started {
	readonly priority: number;
	release(): void;
}

export interface Queue<J> {
	/** Resolves once `job` starts, or with `STALE` if an owner closed or its deadline came first. */
	add(job: J, options?: AddOptions): Promise<Started | Stale>;
	/** Queues `job` with no promise: the queue's `start` and `stale` hear it. */
	push(job: J, options?: AddOptions): void;
	/** Looks again: what `admit` or a priority getter reads has changed. */
	drain(): void;
	/** Jobs waiting to start. */
	readonly waiting: number;
	/** Started jobs holding a place, not yet released. */
	readonly holding: number;
}

const drain_definition = machine<{ idle: {}; draining: {}; again: {} }>()({
	name: 'queue drain',
	initial: 'idle',
	steps: { idle: ['draining'], draining: ['idle', 'again'], again: ['idle', 'draining'] }
});

/** What a paced pass hands its driver: give the thread back, or wait for a job's start-up. */
const PAUSE = Symbol('pause');
type Wait = typeof PAUSE | PromiseLike<unknown>;

/** A job's place in the queue. */
class Ticket<J> implements Started {
	readonly job: J;
	/** Still waiting: a drain takes it out when it starts it. */
	waiting = true;
	/** Started and not released. */
	running = false;
	/** Its place counts toward `max`. */
	holds = false;
	priority = 0;
	readonly deadline: number;
	/** Its owner's link and its deadline timer (`null`: neither). */
	life: Scope | null = null;
	cancel_deadline: (() => void) | null = null;
	/** What `add` resolves (`null`: pushed, nobody awaits it). */
	resolve: ((s: Started | Stale) => void) | null = null;
	readonly #asked: number | (() => number);
	readonly #flight: InFlight | null;
	readonly #q: QueueImpl<J>;

	constructor(q: QueueImpl<J>, job: J, o: AddOptions) {
		this.#q = q;
		this.job = job;
		this.#asked = o.priority ?? 0;
		this.#flight = o.flight ?? null;
		this.deadline = o.deadline ?? Infinity;
	}

	/** Its priority now: what it was asked at, or its flight's when that is higher. */
	read(): number {
		const asked = this.#asked;
		const p = typeof asked === 'number' ? asked : asked();
		const flight = this.#flight;
		return flight !== null && flight.priority > p ? flight.priority : p;
	}

	release(): void {
		if (!this.running) return;
		this.running = false;
		this.life?.close();
		this.#q.released(this);
	}
}

class QueueImpl<J> implements Queue<J> {
	readonly #name: string;
	readonly #max: number;
	readonly #holds: ((priority: number, job: J) => boolean) | null;
	readonly #admit: ((job: J, priority: number) => boolean) | null;
	readonly #start: ((job: J, started: Started) => void | PromiseLike<unknown>) | null;
	readonly #stale: ((job: J) => void) | null;
	readonly #budget: number;
	readonly #pause: ((resume: () => void) => void) | null;
	readonly #deferred: boolean;
	readonly #now: () => number;
	readonly #owner: Scope | null;
	/** Waiting tickets, in the order added (a drain takes out the ones it started). */
	readonly #list: Ticket<J>[] = [];
	#waiting = 0;
	#holding = 0;
	readonly #drain = drain_definition.create();
	/** A paced drain's passes while it runs: resumed after a pause or a start-up. */
	#passes: Generator<Wait, void> | null = null;
	readonly #step = (): void => this.#run();

	constructor(o: QueueOptions<J>) {
		this.#name = o.name ?? 'queue';
		this.#max = o.max ?? Infinity;
		this.#holds = o.holds ?? null;
		this.#admit = o.admit ?? null;
		this.#start = o.start ?? null;
		this.#stale = o.stale ?? null;
		this.#budget = o.budget ?? Infinity;
		this.#pause = o.pause ?? null;
		this.#deferred = o.deferred === true;
		this.#now = o.now ?? clock;
		this.#owner = o.owner ?? null;
		this.#owner?.defer(() => {
			const list = this.#list;
			for (let i = 0; i < list.length; i++) if (list[i].waiting) this.#give_up(list[i]);
			list.length = 0;
		});
	}

	get waiting(): number {
		return this.#waiting;
	}

	get holding(): number {
		return this.#holding;
	}

	add(job: J, o: AddOptions = {}): Promise<Started | Stale> {
		const t = this.#ticket(job, o);
		if (t === null) return Promise.resolve(STALE);
		const started = new Promise<Started | Stale>((resolve) => (t.resolve = resolve));
		this.#enqueue(t, o);
		return started;
	}

	push(job: J, o: AddOptions = {}): void {
		const t = this.#ticket(job, o);
		if (t === null) this.#stale?.(job);
		else this.#enqueue(t, o);
	}

	drain(): void {
		const d = this.#drain;
		const kind = d.now.kind;
		if (kind !== 'idle') {
			if (kind === 'draining') d.go('again');
			return;
		}
		if (!this.#waiting) return;
		d.go('draining');
		if (this.#budget === Infinity && !this.#deferred) {
			this.#passes_now();
			d.go('idle');
			return;
		}
		this.#passes = this.#paced();
		this.#run();
	}

	/** A started ticket gave its place back. */
	released(t: Ticket<J>): void {
		if (!t.holds) return; // (it held no place: none comes free)
		this.#holding--;
		this.drain();
	}

	/** A ticket for `job`, or `null` when an owner is already closed (it is `STALE` at once). */
	#ticket(job: J, o: AddOptions): Ticket<J> | null {
		const p = o.priority;
		if (p !== undefined && typeof p !== 'function' && !Number.isFinite(p))
			throw bad_option('priority', p, 'a finite number or a function');
		if (o.owner?.closed || this.#owner?.closed) return null;
		return new Ticket(this, job, o);
	}

	#enqueue(t: Ticket<J>, o: AddOptions): void {
		this.#list.push(t);
		this.#waiting++;
		this.drain();
		// (made only for one still waiting or running: most start at once, and many end at once too)
		const deadline = t.waiting && t.deadline !== Infinity;
		if (deadline || (o.owner !== undefined && (t.waiting || t.running))) {
			const life = (t.life = o.owner?.child() ?? scope());
			life.defer(() => this.#gone(t));
			if (deadline)
				t.cancel_deadline = life.timeout(
					() => life.close(),
					Math.min(MAX_TIMEOUT_MS, Math.max(0, t.deadline - this.#now()))
				);
		}
		// a caller joined its flight at a higher priority: still waiting, it may start now
		if (t.waiting)
			o.flight?.onRaise(() => {
				if (t.waiting) this.drain();
			});
	}

	/** Its owner closed, or its deadline came: waiting, it settles STALE; started, it is released. */
	#gone(t: Ticket<J>): void {
		if (t.running) return t.release();
		if (!t.waiting) return;
		this.#give_up(t);
		if (this.#drain.now.kind === 'idle') this.#compact();
	}

	#give_up(t: Ticket<J>): void {
		t.waiting = false;
		this.#waiting--;
		t.life?.close();
		if (t.resolve !== null) t.resolve(STALE);
		else this.#stale?.(t.job);
	}

	/** Runs a paced drain's passes until they end, pause, or wait for a job's start-up. */
	#run(): void {
		const r = this.#passes!.next();
		if (r.done) {
			this.#passes = null;
			this.#drain.go('idle');
		} else if (r.value === PAUSE) this.#pause!(this.#step);
		// ok: a start-up that fails is its job's; the drain goes on either way
		else void r.value.then(this.#step, this.#step);
	}

	/** The drain, at once: passes until none was asked for while one ran. */
	#passes_now(): void {
		const d = this.#drain;
		const all_hold = this.#holds === null;
		for (;;) {
			if (d.now.kind === 'again') d.go('draining');
			if (!(all_hold && this.#holding >= this.#max)) {
				const asked = this.#list.length;
				const groups = this.#ordered(asked);
				let ran = false;
				pass: for (let g = 0; g <= groups.length; g++) {
					const tail = g === groups.length;
					const list = tail ? this.#list : groups[g];
					const end = tail || list !== this.#list ? list.length : asked;
					for (let i = tail ? asked : 0; i < end; i++) {
						if (all_hold && this.#holding >= this.#max) break pass;
						const t = list[i];
						if (this.#try(t, ran || tail ? t.read() : t.priority) === false) continue;
						if (this.#start !== null) ran = true;
					}
				}
				this.#compact();
			}
			if (d.now.kind !== 'again') return;
		}
	}

	/**
	 * The paced drain: a pass goes through the waiting jobs by priority (each read once, grouped by
	 * value), then the jobs added while it ran, in the order added. Once a job's start ran, priorities
	 * are read again. Past the budget it pauses, and the next pass begins (priorities may have moved
	 * while the page had the thread). A drain asked for while it ran is one more pass.
	 *
	 * @heisenbench linear
	 */
	*#paced(): Generator<Wait, void> {
		const d = this.#drain;
		const all_hold = this.#holds === null;
		if (this.#deferred) yield PAUSE;
		let until = this.#now() + this.#budget;
		for (;;) {
			if (d.now.kind === 'again') d.go('draining');
			let started = false;
			let paused = false;
			if (!(all_hold && this.#holding >= this.#max)) {
				const asked = this.#list.length;
				const groups = this.#ordered(asked);
				let ran = false;
				pass: for (let g = 0; g <= groups.length; g++) {
					const tail = g === groups.length;
					const list = tail ? this.#list : groups[g];
					const end = tail || list !== this.#list ? list.length : asked;
					for (let i = tail ? asked : 0; i < end; i++) {
						if (all_hold && this.#holding >= this.#max) break pass;
						const t = list[i];
						const hop = this.#try(t, ran || tail ? t.read() : t.priority);
						if (hop === false) continue;
						started = true;
						if (hop !== true) yield hop; // its start-up runs now
						if (hop !== true || this.#start !== null) ran = true;
						if (this.#now() >= until) {
							this.#compact();
							yield PAUSE;
							until = this.#now() + this.#budget;
							paused = true;
							break pass;
						}
					}
				}
			}
			if (!paused) {
				if (started) this.#compact();
				if (d.now.kind !== 'again') return;
			}
		}
	}

	/** The first `asked` tickets by priority (highest first), then the order added: each waiting
	 *  one's priority read once. All at one priority (the common case), the list itself; else
	 *  grouped by value (a sort of the few distinct priorities, not of the queue). */
	#ordered(asked: number): Ticket<J>[][] {
		const list = this.#list;
		let first = 0;
		let one = true;
		let any = false;
		for (let i = 0; i < asked; i++) {
			const t = list[i];
			if (!t.waiting) continue;
			const p = (t.priority = t.read());
			if (!any) {
				any = true;
				first = p;
			} else if (p !== first) one = false;
		}
		if (one) return [list];
		const keys: number[] = [];
		const groups: Ticket<J>[][] = [];
		for (let i = 0; i < asked; i++) {
			const t = list[i];
			if (!t.waiting) continue;
			const at = keys.indexOf(t.priority); // (a handful of distinct priorities)
			if (at === -1) {
				keys.push(t.priority);
				groups.push([t]);
			} else groups[at].push(t);
		}
		const order = keys.map((_, i) => i).sort((a, b) => keys[b] - keys[a]);
		return order.map((i) => groups[i]);
	}

	/** Starts `t` if its queue lets it now: `false` when it did not, else `true`, or the promise
	 *  its start returned (its start-up, waited for before the next start). */
	#try(t: Ticket<J>, priority: number): boolean | PromiseLike<unknown> {
		if (!t.waiting) return false;
		if (t.deadline !== Infinity && t.deadline <= this.#now()) {
			this.#give_up(t);
			return false;
		}
		if (this.#admit !== null && !this.#admit(t.job, priority)) return false;
		const holds = this.#holds === null || this.#holds(priority, t.job);
		if (holds && this.#holding >= this.#max) return false;
		if (holds) this.#holding++;
		this.#waiting--;
		t.waiting = false;
		t.running = true;
		t.priority = priority;
		t.holds = holds;
		t.cancel_deadline?.();
		t.resolve?.(t);
		const start = this.#start;
		if (start === null) return true;
		try {
			const up = start(t.job, t);
			return up != null && typeof up.then === 'function' ? up : true;
		} catch (error) {
			report_thrown('machine_queue_start_failed', { name: this.#name }, error);
			return true;
		}
	}

	/** The tickets no longer waiting out of the list, the rest kept in the order added. */
	#compact(): void {
		const list = this.#list;
		let w = 0;
		for (let i = 0; i < list.length; i++) if (list[i].waiting) list[w++] = list[i];
		list.length = w;
	}
}

/** A queue of jobs that start when there is room, the most urgent first (see the module). */
export function queue<J>(options: QueueOptions<J> = {}): Queue<J> {
	const { max, budget, pause, deferred } = options;
	if (max !== undefined && !(Number.isInteger(max) && max >= 1))
		throw bad_option('max', max, 'a whole number of at least 1');
	if (budget !== undefined && !(typeof budget === 'number' && budget >= 0))
		throw bad_option('budget', budget, 'a number of ms, at least 0');
	if ((budget !== undefined || deferred) && typeof pause !== 'function')
		throw bad_option(
			'pause',
			pause,
			'a function that calls its resume in a new task, with budget or deferred'
		);
	return new QueueImpl(options);
}

function clock(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function bad_option(option: string, value: unknown, rule: string) {
	return machine_error('machine_bad_option', { option, value: String(value), rule });
}
