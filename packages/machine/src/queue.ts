/**
 * Work that waits for its turn: a job starts only when there is room for it, the most urgent first.
 *
 *   const downloads = queue<Download>({
 *     name: 'downloads',
 *     max: 3,                                   // at most three hold a place at once
 *     holds: (priority) => priority < 2,        // urgent ones start past the cap
 *     admit: (d, priority) => gate_open || priority >= 2,
 *     budget: 16, pause: yield_task             // start-up work yields after 16 ms
 *   });
 *   const s = await downloads.add(d, { priority: () => class_of(d), flight, owner });
 *   if (s === STALE) return;                    // its owner closed, or its deadline came
 *   try { await fetch(d.url); } finally { s.release(); }
 *
 * - A job starts when its queue lets it: `admit` says yes, and, if it `holds` a place, fewer than
 *   `max` do. `add` resolves then, with a `release` to call once the work is done (once: a second
 *   call does nothing). A release hands its place to the next job in the same step: a job added
 *   meanwhile queues behind it instead of starting beside it.
 * - The most urgent starts first: the highest `priority`, then the order added. A getter is read
 *   again at each drain. A job that serves a flight (`flight`) is at least at the flight's priority,
 *   and a caller raising the flight drains the queue: the job moves up while it waits.
 * - `drain()` looks again: something `admit` or a priority getter reads changed.
 * - `budget` (ms): a drain gives the thread back after starting jobs for this long (`pause`, a new
 *   task), and goes on after it. Each job's own start-up runs before the budget is read again.
 *   `deferred`: a drain begins with a pause, never in the step that added.
 * - `deadline` (by `now`): a job still waiting then settles `STALE` and never starts (one whose
 *   deadline came is passed over even before its timer runs).
 * - `owner`: its scope closing settles a waiting job `STALE`, and gives a started one's place back.
 *
 * One drain runs at a time: one asked for while it runs goes round once more when it is done.
 */
import { machine } from './machine.ts';
import { machine_error } from './messages.ts';
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
	/** How long (ms) a drain starts jobs before it gives the thread back with `pause`. */
	budget?: number;
	/** How a drain gives the thread back: resolves in a new task. Needed by `budget` and `deferred`. */
	pause?: () => Promise<unknown>;
	/** A drain begins after a `pause`, never in the step that added. */
	deferred?: boolean;
	/** The clock for `budget` and `deadline` (ms): `performance.now()` when left out. */
	now?: () => number;
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
	/** Resolves once `job` starts, or with `STALE` if its owner closed or its deadline came first. */
	add(job: J, options?: AddOptions): Promise<Started | Stale>;
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
	#asked: number | (() => number);
	#flight: InFlight | null;
	#q: QueueImpl<J>;
	#resolve!: (s: Started | Stale) => void;
	readonly started: Promise<Started | Stale>;

	constructor(q: QueueImpl<J>, job: J, o: AddOptions) {
		this.#q = q;
		this.job = job;
		this.#asked = o.priority ?? 0;
		this.#flight = o.flight ?? null;
		this.deadline = o.deadline ?? Infinity;
		this.started = new Promise((r) => (this.#resolve = r));
	}

	/** Its priority now: what it was asked at, or its flight's when that is higher. */
	read(): number {
		const asked = this.#asked;
		const p = typeof asked === 'number' ? asked : asked();
		const flight = this.#flight;
		return flight !== null && flight.priority > p ? flight.priority : p;
	}

	start(priority: number, holds: boolean): void {
		this.waiting = false;
		this.running = true;
		this.priority = priority;
		this.holds = holds;
		this.cancel_deadline?.();
		this.#resolve(this);
	}

	give_up(): void {
		this.waiting = false;
		this.life?.close();
		this.#resolve(STALE);
	}

	release(): void {
		if (!this.running) return;
		this.running = false;
		this.life?.close();
		this.#q.released(this);
	}
}

class QueueImpl<J> implements Queue<J> {
	readonly #max: number;
	readonly #holds: ((priority: number, job: J) => boolean) | null;
	readonly #admit: ((job: J, priority: number) => boolean) | null;
	readonly #budget: number;
	readonly #pause: (() => Promise<unknown>) | null;
	readonly #deferred: boolean;
	readonly #now: () => number;
	/** Waiting tickets, in the order added (a drain takes out the ones it started). */
	#list: Ticket<J>[] = [];
	#waiting = 0;
	#holding = 0;
	readonly #drain = drain_definition.create();

	constructor(o: QueueOptions<J>) {
		this.#max = o.max ?? Infinity;
		this.#holds = o.holds ?? null;
		this.#admit = o.admit ?? null;
		this.#budget = o.budget ?? Infinity;
		this.#pause = o.pause ?? null;
		this.#deferred = o.deferred === true;
		this.#now = o.now ?? clock;
	}

	get waiting(): number {
		return this.#waiting;
	}

	get holding(): number {
		return this.#holding;
	}

	add(job: J, o: AddOptions = {}): Promise<Started | Stale> {
		const p = o.priority;
		if (p !== undefined && typeof p !== 'function' && !Number.isFinite(p))
			throw bad_option('priority', p, 'a finite number or a function');
		if (o.owner?.closed) return Promise.resolve(STALE);
		const t = new Ticket(this, job, o);
		if (o.owner !== undefined || t.deadline !== Infinity) {
			const life = (t.life = o.owner?.child() ?? scope());
			life.defer(() => this.#gone(t));
			if (t.deadline !== Infinity)
				t.cancel_deadline = life.timeout(
					() => life.close(),
					Math.min(MAX_TIMEOUT_MS, Math.max(0, t.deadline - this.#now()))
				);
		}
		this.#list.push(t);
		this.#waiting++;
		// a caller joined its flight at a higher priority: still waiting, it may start now
		o.flight?.onRaise(() => {
			if (t.waiting) this.drain();
		});
		this.drain();
		return t.started;
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
			// every start at once: a release hands its place on in the same step
			const again = (): boolean => d.now.kind === 'again'; // (read after the pass ran)
			do {
				if (again()) d.go('draining');
				this.#pass_now();
			} while (again());
			d.go('idle');
			return;
		}
		void this.#pass_paced().finally(() => {
			const again = d.now.kind === 'again';
			d.go('idle');
			if (again) this.drain();
		}); // ok: a pass only starts jobs and pauses; it never rejects
	}

	/** A started ticket gave its place back. */
	released(t: Ticket<J>): void {
		if (!t.holds) return; // (it held no place: none comes free)
		this.#holding--;
		this.drain();
	}

	/** Its owner closed, or its deadline came: waiting, it settles STALE; started, it is released. */
	#gone(t: Ticket<J>): void {
		if (t.running) return t.release();
		if (!t.waiting) return;
		this.#waiting--;
		t.give_up();
		if (this.#drain.now.kind === 'idle') this.#compact();
	}

	/** The waiting tickets by priority (highest first), then the order added: each read once, and
	 *  grouped by value (a sort of the few distinct priorities, not of the queue). */
	#ordered(): Ticket<J>[][] {
		const groups = new Map<number, Ticket<J>[]>(); // (one per pass, not module-level)
		for (const t of this.#list) {
			if (!t.waiting) continue;
			const p = (t.priority = t.read());
			const g = groups.get(p);
			if (g) g.push(t);
			else groups.set(p, [t]);
		}
		return [...groups.keys()].sort((a, b) => b - a).map((p) => groups.get(p)!);
	}

	/** Starts `t` if its queue lets it now: whether it started. */
	#try(t: Ticket<J>, priority: number): boolean {
		if (!t.waiting) return false;
		if (t.deadline !== Infinity && t.deadline <= this.#now()) {
			this.#waiting--;
			t.give_up();
			return false;
		}
		if (this.#admit !== null && !this.#admit(t.job, priority)) return false;
		const holds = this.#holds === null || this.#holds(priority, t.job);
		if (holds && this.#holding >= this.#max) return false;
		if (holds) this.#holding++;
		this.#waiting--;
		t.start(priority, holds);
		return true;
	}

	/** One pass, every start in this step. */
	#pass_now(): void {
		// (with every job holding a place, a full queue starts nothing more this pass)
		const all_hold = this.#holds === null;
		if (all_hold && this.#holding >= this.#max) return;
		pass: for (const group of this.#ordered())
			for (const t of group) {
				if (all_hold && this.#holding >= this.#max) break pass;
				this.#try(t, t.priority);
			}
		this.#compact();
	}

	/**
	 * Passes that let each started job's own start-up run (a microtask) before the next start, and
	 * give the thread back past the budget. A pass goes through the queue by priority, then the jobs
	 * added while it ran, in the order added. Once a job has run, priorities are read again.
	 *
	 * @heisenbench linear
	 */
	async #pass_paced(): Promise<void> {
		const d = this.#drain;
		if (this.#deferred) await this.#pause!();
		let until = this.#now() + this.#budget;
		for (;;) {
			if (d.now.kind === 'again') d.go('draining');
			const asked = this.#list.length;
			const groups = this.#ordered();
			groups.push(this.#list); // then the ones added while it ran
			let ran = false;
			let started = false;
			let paused = false;
			pass: for (let g = 0; g < groups.length; g++) {
				const list = groups[g];
				const tail = g === groups.length - 1;
				for (let i = tail ? asked : 0; i < list.length; i++) {
					const t = list[i];
					if (!this.#try(t, ran || tail ? t.read() : t.priority)) continue;
					started = true;
					await Promise.resolve(); // its start-up runs now
					ran = true;
					if (this.#now() >= until) {
						this.#compact();
						await this.#pause!();
						until = this.#now() + this.#budget;
						paused = true;
						break pass; // priorities may have moved while the page had the thread
					}
				}
			}
			if (!paused) {
				if (started) this.#compact();
				if (d.now.kind !== 'again') return;
			}
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
			'a function that resolves in a new task, with budget or deferred'
		);
	return new QueueImpl(options);
}

function clock(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function bad_option(option: string, value: unknown, rule: string) {
	return machine_error('machine_bad_option', { option, value: String(value), rule });
}
