/**
 * Work that waits for room: at most `max` jobs hold a place at once, first come, first served.
 *
 *   const renders = queue<Call>({
 *     max: 4,
 *     start: (call, place) => call.enter(place), // its turn: in the step its place came free
 *     stale: (call) => call.gone()       // its deadline came, it was cancelled, or the owner closed
 *   });
 *   renders.push(call, Date.now() + 5_000);
 *   signal.addEventListener('abort', () => renders.cancel(call));
 *   // … once the call's work is done:
 *   place.release();
 *
 * - `start` starts a job in the step its place comes free, and hands it its `place`: the job's own,
 *   given back once by `place.release()` (a second release does nothing, so it never frees another
 *   job's place). A release hands the place to the next job at once, so a job pushed meanwhile
 *   queues behind it instead of starting beside it. A start that throws is reported
 *   (machine_queue_start_failed) and its place goes back; the jobs after it still start.
 * - A wait never hangs. A job still waiting at its deadline (by `now`) is `stale` and never starts;
 *   one whose deadline came is passed over even before the timer runs. The deadlines share one timer,
 *   at the earliest one waiting, and it goes once none waits.
 * - `cancel(job)` makes a waiting job `stale` at once; a started one is untouched.
 * - The queue's `owner` closing makes every waiting job `stale`, and any pushed after.
 *
 * A waiting line with more rules than "first come" says them as options, and the queue then starts
 * jobs in passes:
 *
 * - `priority(job)`: the higher starts first; ties keep the order pushed. Read for every waiting job
 *   at the start of each pass, so a raise counts at the next pass (`recheck()` asks for one).
 * - `ready(job)`: a job that is not ready is passed over, and the jobs behind it still start.
 * - `windows`: each `{ max, holds(job) }` caps the jobs it holds, beside `max`. A job is counted in
 *   the windows that hold it when it starts, until its place is released.
 * - `budget: { ms, yield }`: a drain that has started jobs for `ms` hands the thread back through
 *   `yield(resume)`, and goes on with a new pass when resumed.
 *
 * A pass reads the waiting jobs once, in priority order, then the jobs pushed while it runs, in the
 * order pushed. A push, a release or a `recheck()` while it runs asks for another pass after it.
 * The plain queue (a `max`, none of these options) starts strictly from the front, a step per job.
 *
 * The queue keeps the jobs themselves, in the order pushed: no record per job. A start that pushes,
 * cancels or releases runs inside the drain safely: each start takes its job out of the line first.
 */
import { machine_error, report_thrown } from './messages.ts';
import { clock } from './ports.ts';
import { MAX_TIMEOUT_MS, scope, type Scope } from './scope.ts';

export interface QueueOptions<J> {
	/** Names the queue in messages. */
	name?: string;
	/** The most jobs holding a place at once. No cap when left out. */
	max?: number;
	/** Starts a job: `place` is its until `place.release()`. */
	start: (job: J, place: Place) => void;
	/** Hears a job that will never start: its deadline came, it was cancelled, or the owner closed. */
	stale?: (job: J) => void;
	/** The clock deadlines and the budget are read on (ms). `clock.mono()` when left out. */
	now?: () => number;
	/** Closing it makes every waiting job stale, and any pushed after. */
	owner?: Scope;
	/** A waiting job's rank, read at the start of every pass: the higher starts first, ties in the
	 *  order pushed. */
	priority?: (job: J) => number;
	/** Whether a waiting job may start now. One that is not is passed over; the jobs behind it still
	 *  start. Read each time a pass reaches the job. */
	ready?: (job: J) => boolean;
	/** Caps beside `max`, each over the jobs it `holds` (read as the job starts; it stays counted
	 *  until its place is released). A job may be held by several. */
	windows?: readonly QueueWindow<J>[];
	/** Hands the thread back while a drain runs long. */
	budget?: QueueBudget;
}

/** A cap over some of a queue's jobs. */
export interface QueueWindow<J> {
	/** The most jobs it holds that hold a place at once. */
	max: number;
	/** Whether `job` is one of this window's. */
	holds: (job: J) => boolean;
}

/** How long a drain may start jobs before it hands the thread back. */
export interface QueueBudget {
	/** The time a drain starts jobs for, by the queue's `now`, before it yields. */
	ms: number;
	/** Hands the thread back: calls `resume` once the drain may go on (a later task). */
	yield: (resume: () => void) => void;
	/** A drain begins with a yield, so no job starts in the step that pushed it. */
	defer?: boolean;
	/** After each start the drain waits a microtask: the work a start hands on by a promise takes its
	 *  first step before the next job is chosen, and counts against the budget. */
	settle?: boolean;
}

export interface Queue<J> {
	/** Queues `job`, to start in turn, or to be stale at `deadline` (by the queue's `now`). */
	push(job: J, deadline?: number): void;
	/** A waiting `job` leaves at once, stale. A started one is untouched. */
	cancel(job: J): void;
	/** What a pass reads (a priority, a job's readiness, a window it falls in) may have changed:
	 *  the queue drains again. */
	recheck(): void;
	/** Jobs waiting to start. */
	readonly waiting: number;
	/** Started jobs holding a place, not yet released. */
	readonly holding: number;
}

/** A started job's place in the queue: its own, given back once. */
export interface Place {
	/** The job's work is done: its place goes to the next job, in this step. Once: a second call
	 *  does nothing. */
	release(): void;
}

/** A place in the list a job left (cancelled, or past its deadline). */
const GONE: unique symbol = Symbol('gone');

type DrainState = 'idle' | 'deferred' | 'running' | 'again' | 'yielding' | 'ending';

const COUNTED_SPAN = 64;

const UNCOUNTED: Place & { held: boolean } = Object.freeze({ held: false, release: noop });

const IN_ORDER_PUSHED: readonly number[] = [];

function noop(): void {}

abstract class Line<J> implements Queue<J> {
	protected readonly _name: string;
	protected readonly _max: number;
	protected readonly _start: (job: J, place: Place) => void;
	protected readonly _now: () => number;
	protected readonly _owner: Scope | null;
	protected readonly _jobs: Array<J | typeof GONE> = [];
	protected readonly _deadlines: number[] = [];
	protected _head = 0;
	protected _waiting = 0;
	protected _holding = 0;
	readonly #stale: ((job: J) => void) | null;
	#timed = 0;
	#armed_at = Infinity;
	#disarm: (() => void) | null = null;
	#timers: Scope | null = null;

	constructor(o: QueueOptions<J>) {
		this._name = o.name ?? 'queue';
		this._max = o.max ?? Infinity;
		this._start = o.start;
		this.#stale = o.stale ?? null;
		this._now = o.now ?? clock.mono;
		this._owner = o.owner ?? null;
		this._owner?.defer(() => this.#leave_where(() => true));
	}

	get waiting(): number {
		return this._waiting;
	}

	get holding(): number {
		return this._holding;
	}

	push(job: J, deadline = Infinity): void {
		if (this._owner?.closed) return this._stale_job(job);
		this._jobs.push(job);
		this._deadlines.push(deadline);
		this._waiting++;
		if (deadline !== Infinity) this.#timed++;
		this._drain();
		if (deadline < this.#armed_at && this._jobs.length > this._head) this.#arm(deadline);
	}

	cancel(job: J): void {
		const at = this._jobs.indexOf(job, this._head);
		if (at !== -1) this._leave(at);
	}

	recheck(): void {
		this._drain();
	}

	protected abstract _drain(): void;

	protected abstract _compact(): void;

	/** The job at `at` leaves while it waits: stale. */
	protected _leave(at: number): void {
		const job = this._jobs[at] as J;
		this._jobs[at] = GONE;
		this._waiting--;
		if (this._deadlines[at] !== Infinity) this._untime();
		this._stale_job(job);
	}

	/** A job is stale: its hook hears it. One that throws is reported, and the others still go on. */
	protected _stale_job(job: J): void {
		try {
			this.#stale?.(job);
		} catch (error) {
			report_thrown('machine_queue_stale_failed', { name: this._name }, error);
		}
	}

	/** A waiting job with a deadline left: the last one takes the timer with it. */
	protected _untime(): void {
		if (--this.#timed > 0 || this.#disarm === null) return;
		this.#disarm();
		this.#disarm = null;
		this.#armed_at = Infinity;
	}

	/** The one timer goes off at `at` (the earliest deadline waiting). */
	#arm(at: number): void {
		this.#disarm?.();
		this.#armed_at = at;
		const timers = (this.#timers ??= this._owner?.child() ?? scope());
		const ms = Math.min(MAX_TIMEOUT_MS, Math.max(0, at - this._now()));
		this.#disarm = timers.timeout(() => this.#expire(), ms);
	}

	/** The deadlines that came: those jobs are stale; the timer goes on to the next one. */
	#expire(): void {
		this.#disarm = null;
		this.#armed_at = Infinity;
		const now = this._now();
		this.#leave_where((deadline) => deadline <= now);
		let next = Infinity;
		const jobs = this._jobs;
		for (let i = this._head; i < jobs.length; i++)
			if (jobs[i] !== GONE && this._deadlines[i] < next) next = this._deadlines[i];
		if (next !== Infinity) this.#arm(next);
		this._compact();
	}

	/** The waiting jobs `test` picks (by deadline) leave, stale. They are picked first and each is
	 *  found again as it leaves: a `stale` that pushes or releases may compact the list under it. */
	#leave_where(test: (deadline: number) => boolean): void {
		const picked: J[] = []; // (one per call)
		for (let i = this._head; i < this._jobs.length; i++) {
			const job = this._jobs[i];
			if (job !== GONE && test(this._deadlines[i])) picked.push(job);
		}
		for (const job of picked) {
			const at = this._jobs.indexOf(job, this._head);
			if (at !== -1) this._leave(at);
		}
	}
}

class PlainLine<J> extends Line<J> {
	#place(): Place & { held: boolean } {
		const place = {
			held: true,
			release: () => {
				if (!place.held) return;
				place.held = false;
				this._holding--;
				this._drain();
			}
		};
		return place;
	}

	protected _drain(): void {
		if (this._owner?.closed) return;
		while (this._holding < this._max && this._head < this._jobs.length) {
			const at = this._head++;
			const job = this._jobs[at];
			if (job === GONE) continue;
			const deadline = this._deadlines[at];
			this._jobs[at] = GONE;
			this._waiting--;
			if (deadline !== Infinity) {
				this._untime();
				if (deadline <= this._now()) {
					this._stale_job(job);
					continue;
				}
			}
			this._holding++;
			const place = this.#place();
			try {
				this._start(job, place);
			} catch (error) {
				report_thrown('machine_queue_start_failed', { name: this._name }, error);
				if (place.held) {
					place.held = false;
					this._holding--;
				}
			}
		}
		this._compact();
	}

	/** The started and gone front of the list out, once it is the larger part. */
	protected _compact(): void {
		const head = this._head;
		if (head < 32 || head * 2 < this._jobs.length) {
			if (head === this._jobs.length && head > 0) {
				this._jobs.length = this._deadlines.length = this._head = 0;
			}
			return;
		}
		this._jobs.splice(0, head);
		this._deadlines.splice(0, head);
		this._head = 0;
	}
}

class PassLine<J> extends Line<J> {
	readonly #priority: ((job: J) => number) | null;
	readonly #ready: ((job: J) => boolean) | null;
	readonly #windows: readonly QueueWindow<J>[];
	readonly #counts: number[];
	readonly #budget: QueueBudget | null;
	readonly #counted: boolean;
	#state: DrainState = 'idle';
	#pass: readonly number[] | null = null;
	#at = 0;
	#extra = 0;
	#until = Infinity;

	constructor(o: QueueOptions<J>) {
		super(o);
		this.#priority = o.priority ?? null;
		this.#ready = o.ready ?? null;
		this.#windows = o.windows ? [...o.windows] : [];
		this.#counts = this.#windows.map(() => 0);
		this.#budget = o.budget ? { ...o.budget } : null;
		this.#counted = this._max !== Infinity || this.#windows.length > 0;
	}

	protected _drain(): void {
		const state = this.#state;
		if (state === 'running' || state === 'ending') this.#state = 'again';
		if (state !== 'idle' || this._waiting === 0 || this._owner?.closed) return;
		const budget = this.#budget;
		if (budget?.defer) {
			this.#state = 'deferred';
			return this.#hand_back(budget);
		}
		this.#state = 'running';
		this.#until = budget ? this._now() + budget.ms : Infinity;
		this.#run();
	}

	#place(mask: number): Place & { held: boolean } {
		const place = {
			held: true,
			release: () => {
				if (!place.held) return;
				place.held = false;
				this.#give_back(mask);
				this._drain();
			}
		};
		return place;
	}

	#give_back(mask: number): void {
		this._holding--;
		for (let w = 0; mask !== 0; w++, mask >>>= 1) if (mask & 1) this.#counts[w]--;
	}

	#hold(job: J, mask: number): void {
		let place: Place & { held: boolean } = UNCOUNTED;
		if (this.#counted) {
			this._holding++;
			for (let w = 0, m = mask; m !== 0; w++, m >>>= 1) if (m & 1) this.#counts[w]++;
			place = this.#place(mask);
		}
		try {
			this._start(job, place);
		} catch (error) {
			report_thrown('machine_queue_start_failed', { name: this._name }, error);
			if (place.held) {
				place.held = false;
				this.#give_back(mask);
			}
		}
	}

	#run(): void {
		try {
			this.#passes_run();
		} catch (error) {
			this.#end();
			throw error;
		}
	}

	#passes_run(): void {
		const budget = this.#budget;
		const jobs = this._jobs;
		const max = this._max;
		let pass = (this.#pass ??= this.#order());
		let next = this.#at;
		let extra = this.#extra;
		for (;;) {
			let at = -1;
			if (this._holding < max) {
				if (next < pass.length) at = pass[next++];
				else if (extra < jobs.length) at = extra++;
			}
			if (at === -1) {
				this.#pass = null;
				if (this.#state !== 'again') return budget?.settle ? this.#ending() : this.#end();
				this.#state = 'running';
				pass = this.#pass = this.#order();
				next = 0;
				extra = this.#extra;
				continue;
			}
			if (!this.#take(at) || budget === null) continue;
			if (budget.settle) {
				this.#at = next;
				this.#extra = extra;
				return void Promise.resolve().then(() => this.#settled(budget));
			}
			if (this._waiting > 0 && this._now() >= this.#until) return this.#yield(budget);
		}
	}

	#settled(budget: QueueBudget): void {
		if (this._owner?.closed) return this.#end();
		if (this._waiting > 0 && this._now() >= this.#until) return this.#yield(budget);
		this.#run();
	}

	#yield(budget: QueueBudget): void {
		this.#pass = null;
		this.#state = 'yielding';
		this.#hand_back(budget);
	}

	#ending(): void {
		this.#state = 'ending';
		// oxlint-disable-next-line ogygia/no-silent-failures -- a drain's end never rejects: a rule that throws in it reaches the page as an unhandled rejection
		void Promise.resolve().then(() => this.#ended());
	}

	#ended(): void {
		if (this.#state !== 'again' || this._waiting === 0 || this._owner?.closed) return this.#end();
		this.#state = 'running';
		this.#until = this._now() + this.#budget!.ms;
		this.#run();
	}

	#hand_back(budget: QueueBudget): void {
		const waited = this.#state;
		let resumed = false;
		const resume = () => {
			if (resumed || this.#state !== waited) return;
			resumed = true;
			if (this._owner?.closed) return this.#end();
			this.#state = 'running';
			this.#until = this._now() + budget.ms;
			this.#run();
		};
		try {
			budget.yield(resume);
		} catch (error) {
			if (resumed) throw error;
			report_thrown('machine_queue_yield_failed', { name: this._name }, error);
			resume();
		}
	}

	#end(): void {
		this.#state = 'idle';
		this.#pass = null;
		this._compact();
	}

	#order(): readonly number[] {
		const jobs = this._jobs;
		const n = jobs.length;
		while (this._head < n && jobs[this._head] === GONE) this._head++;
		this.#at = 0;
		this.#extra = n;
		const by = this.#priority;
		if (by === null) {
			this.#extra = this._head;
			return IN_ORDER_PUSHED;
		}
		const places: number[] = [];
		const ranks: number[] = [];
		let count = 0;
		let lo = Infinity;
		let hi = -Infinity;
		let whole = true;
		for (let i = this._head; i < n; i++) {
			const job = jobs[i];
			if (job === GONE) continue;
			let rank = by(job);
			if (rank !== rank) rank = -Infinity;
			places[count] = i;
			ranks[count++] = rank;
			if (rank < lo) lo = rank;
			if (rank > hi) hi = rank;
			if ((rank | 0) !== rank) whole = false;
		}
		if (count < 2) return places;
		if (whole && hi - lo < COUNTED_SPAN) {
			const span = hi - lo + 2;
			const starts: number[] = [];
			for (let s = 0; s < span; s++) starts[s] = 0;
			for (let k = 0; k < count; k++) starts[hi - ranks[k] + 1]++;
			for (let s = 1; s < span; s++) starts[s] += starts[s - 1];
			const out = places.slice();
			for (let k = 0; k < count; k++) out[starts[hi - ranks[k]]++] = places[k];
			return out;
		}
		const keys = places.map((_, k) => k);
		keys.sort((a, b) => ranks[b] - ranks[a] || a - b);
		return keys.map((k) => places[k]);
	}

	#take(at: number): boolean {
		const jobs = this._jobs;
		const job = jobs[at];
		if (job === GONE) return false;
		const deadline = this._deadlines[at];
		if (deadline !== Infinity && deadline <= this._now()) {
			this._leave(at);
			return false;
		}
		const ready = this.#ready;
		if (ready !== null && !ready(job)) return false;
		let mask = 0;
		const windows = this.#windows;
		for (let w = 0; w < windows.length; w++) {
			if (!windows[w].holds(job)) continue;
			if (this.#counts[w] >= windows[w].max) return false;
			mask |= 1 << w;
		}
		jobs[at] = GONE;
		this._waiting--;
		if (deadline !== Infinity) this._untime();
		this.#hold(job, mask);
		return true;
	}

	protected _compact(): void {
		const jobs = this._jobs;
		if (this.#pass !== null || jobs.length === this._waiting) return;
		const deadlines = this._deadlines;
		if (this._waiting === 0) {
			jobs.length = deadlines.length = this._head = 0;
			return;
		}
		let front = this._head;
		this._head = 0;
		while (jobs[front] === GONE) front++;
		if (jobs.length - front === this._waiting) {
			jobs.splice(0, front);
			deadlines.splice(0, front);
			return;
		}
		let w = 0;
		for (let i = front; i < jobs.length; i++) {
			if (jobs[i] === GONE) continue;
			jobs[w] = jobs[i];
			deadlines[w++] = deadlines[i];
		}
		jobs.length = deadlines.length = w;
	}
}

const MAX_WINDOWS = 31;

function cap(option: string, value: number): void {
	if (!(Number.isInteger(value) && value >= 1))
		throw machine_error('machine_bad_option', {
			option,
			value: String(value),
			rule: 'a whole number of at least 1'
		});
}

/** A bounded queue of jobs: first come, first served, or by the rules its options give (see the
 *  module). */
export function queue<J>(options: QueueOptions<J>): Queue<J> {
	const { max } = options;
	if (max !== undefined && !(Number.isInteger(max) && max >= 1))
		throw machine_error('machine_bad_option', {
			option: 'max',
			value: String(max),
			rule: 'a whole number of at least 1'
		});
	if (
		max === undefined ||
		options.priority !== undefined ||
		options.ready !== undefined ||
		options.windows !== undefined ||
		options.budget !== undefined
	)
		return passes(options);
	return new PlainLine(options);
}

function passes<J>(options: QueueOptions<J>): Queue<J> {
	const windows = options.windows ?? [];
	if (windows.length > MAX_WINDOWS)
		throw machine_error('machine_bad_option', {
			option: 'windows',
			value: String(windows.length),
			rule: `at most ${MAX_WINDOWS} windows`
		});
	for (let w = 0; w < windows.length; w++) cap(`windows[${w}].max`, windows[w].max);
	const ms = options.budget?.ms;
	if (ms !== undefined && !(Number.isFinite(ms) && ms >= 0))
		throw machine_error('machine_bad_option', {
			option: 'budget.ms',
			value: String(ms),
			rule: 'a time of at least 0 ms'
		});
	return new PassLine(options);
}
