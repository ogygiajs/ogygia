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
 * The plain queue (none of these options) starts strictly from the front, a step per job.
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

/** A place in the list a job left (it started, was cancelled, or is past its deadline). */
const GONE: unique symbol = Symbol('gone');

/** Where a drain of a queue with passes is: `again` is a pass running that was asked for once more;
 *  `deferred` and `yielding` wait for the budget's `resume`. */
type DrainState = 'idle' | 'deferred' | 'running' | 'again' | 'yielding';

/** Priorities a pass orders by counting: whole numbers this close together. */
const COUNTED_SPAN = 64;

class QueueImpl<J> implements Queue<J> {
	readonly #name: string;
	readonly #max: number;
	readonly #start: (job: J, place: Place) => void;
	readonly #stale: ((job: J) => void) | null;
	readonly #now: () => number;
	readonly #owner: Scope | null;
	readonly #priority: ((job: J) => number) | null;
	readonly #ready: ((job: J) => boolean) | null;
	readonly #windows: readonly QueueWindow<J>[];
	readonly #budget: QueueBudget | null;
	/** Starts in passes: any of `priority`, `ready`, `windows` or `budget` was given. */
	readonly #passes: boolean;
	/** The jobs in the order pushed; the ones before `#head` started. */
	#jobs: Array<J | typeof GONE> = [];
	/** Each job's deadline, beside it (`Infinity`: none). */
	#deadlines: number[] = [];
	#head = 0;
	#waiting = 0;
	#holding = 0;
	/** Started jobs each window holds. */
	readonly #counts: number[];
	/** Waiting jobs with a deadline; the one timer, armed at `#armed_at`. */
	#timed = 0;
	#armed_at = Infinity;
	#disarm: (() => void) | null = null;
	#timers: Scope | null = null;
	#state: DrainState = 'idle';
	/** The open pass: the places in `#jobs` it reads, in its order (`null` between passes). */
	#pass: number[] | null = null;
	/** The next place in `#pass`; past its end, `#extra` walks the jobs pushed since it began. */
	#at = 0;
	#extra = 0;
	/** When the drain yields (by `#now`). */
	#until = Infinity;

	constructor(o: QueueOptions<J>) {
		this.#name = o.name ?? 'queue';
		this.#max = o.max ?? Infinity;
		this.#start = o.start;
		this.#stale = o.stale ?? null;
		this.#now = o.now ?? clock.mono;
		this.#owner = o.owner ?? null;
		this.#priority = o.priority ?? null;
		this.#ready = o.ready ?? null;
		this.#windows = o.windows ? [...o.windows] : [];
		this.#counts = this.#windows.map(() => 0);
		this.#budget = o.budget ? { ...o.budget } : null;
		this.#passes =
			this.#priority !== null ||
			this.#ready !== null ||
			this.#windows.length > 0 ||
			this.#budget !== null;
		this.#owner?.defer(() => this.#leave_where(() => true));
	}

	get waiting(): number {
		return this.#waiting;
	}

	get holding(): number {
		return this.#holding;
	}

	push(job: J, deadline = Infinity): void {
		if (this.#owner?.closed) return this.#stale_job(job);
		this.#jobs.push(job);
		this.#deadlines.push(deadline);
		this.#waiting++;
		if (deadline !== Infinity) this.#timed++;
		if (this.#passes) this.#ask_pass();
		else this.#drain();
		if (deadline < this.#armed_at && this.#jobs.length > this.#head) this.#arm(deadline);
	}

	cancel(job: J): void {
		const at = this.#jobs.indexOf(job, this.#head);
		if (at !== -1) this.#leave(at);
	}

	recheck(): void {
		if (this.#passes) this.#ask_pass();
		else this.#drain();
	}

	/** A place for a job starting now: given back once, by its job or by a start that threw. */
	#place(): Place & { held: boolean } {
		const place = {
			held: true,
			release: () => {
				if (!place.held) return;
				place.held = false;
				this.#holding--;
				this.#drain();
			}
		};
		return place;
	}

	/** A place in a queue with passes, counted in the windows `mask` names. */
	#pass_place(mask: number): Place & { held: boolean } {
		const place = {
			held: true,
			release: () => {
				if (!place.held) return;
				place.held = false;
				this.#give_back(mask);
				this.#ask_pass();
			}
		};
		return place;
	}

	#give_back(mask: number): void {
		this.#holding--;
		for (let w = 0; mask !== 0; w++, mask >>>= 1) if (mask & 1) this.#counts[w]--;
	}

	/** Starts `job` (out of the line already) in a place of its own, counted in its windows. */
	#hold(job: J, mask: number): void {
		this.#holding++;
		for (let w = 0, m = mask; m !== 0; w++, m >>>= 1) if (m & 1) this.#counts[w]++;
		const place = this.#pass_place(mask);
		try {
			this.#start(job, place);
		} catch (error) {
			report_thrown('machine_queue_start_failed', { name: this.#name }, error);
			if (place.held) {
				place.held = false;
				this.#give_back(mask);
			}
		}
	}

	/** Starts jobs from the front while there is room (the plain queue). */
	#drain(): void {
		if (this.#owner?.closed) return; // (its waiting jobs are stale: none starts)
		while (this.#holding < this.#max && this.#head < this.#jobs.length) {
			const at = this.#head++;
			const job = this.#jobs[at];
			if (job === GONE) continue;
			const deadline = this.#deadlines[at];
			this.#jobs[at] = GONE;
			this.#waiting--;
			if (deadline !== Infinity) {
				this.#untime();
				if (deadline <= this.#now()) {
					this.#stale_job(job);
					continue;
				}
			}
			this.#holding++;
			const place = this.#place();
			try {
				this.#start(job, place);
			} catch (error) {
				report_thrown('machine_queue_start_failed', { name: this.#name }, error);
				if (place.held) {
					place.held = false;
					this.#holding--;
				}
			}
		}
		this.#compact();
	}

	/** A pass is asked for: one starts now (or after the budget's first yield), or the one running
	 *  is followed by another. */
	#ask_pass(): void {
		const state = this.#state;
		if (state === 'running') this.#state = 'again';
		if (state !== 'idle' || this.#waiting === 0 || this.#owner?.closed) return;
		const budget = this.#budget;
		if (budget?.defer) {
			this.#state = 'deferred';
			return this.#hand_back(budget);
		}
		this.#state = 'running';
		this.#until = budget ? this.#now() + budget.ms : Infinity;
		this.#run();
	}

	/** Runs passes until the line has nothing left to start, or the drain waits (a settle, a yield).
	 *  A rule that throws (`priority`, `ready`, a window's `holds`) ends the drain and throws to
	 *  whoever woke it; the next push, release or recheck drains again. */
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
		for (;;) {
			if (this.#owner?.closed) return this.#end();
			const pass = (this.#pass ??= this.#order());
			let at = -1;
			if (this.#holding < this.#max) {
				if (this.#at < pass.length) at = pass[this.#at++];
				else if (this.#extra < this.#jobs.length) at = this.#extra++;
			}
			if (at === -1) {
				this.#pass = null;
				if (this.#state !== 'again') return this.#end();
				this.#state = 'running';
				continue;
			}
			if (!this.#take(at) || budget === null) continue;
			if (budget.settle) return void Promise.resolve().then(() => this.#settled(budget));
			if (this.#waiting > 0 && this.#now() >= this.#until) return this.#yield(budget);
		}
	}

	/** A start's microtask ran: the drain yields if its time is up, else goes on. */
	#settled(budget: QueueBudget): void {
		if (this.#owner?.closed) return this.#end();
		if (this.#waiting > 0 && this.#now() >= this.#until) return this.#yield(budget);
		this.#run();
	}

	#yield(budget: QueueBudget): void {
		this.#pass = null;
		this.#state = 'yielding';
		this.#sweep();
		this.#hand_back(budget);
	}

	/** Gives the thread back through the budget's `yield`; its `resume` opens a new pass, once. */
	#hand_back(budget: QueueBudget): void {
		const waited = this.#state;
		let resumed = false;
		const resume = () => {
			if (resumed || this.#state !== waited) return;
			resumed = true;
			if (this.#owner?.closed) return this.#end();
			this.#state = 'running';
			this.#until = this.#now() + budget.ms;
			this.#run();
		};
		try {
			budget.yield(resume);
		} catch (error) {
			if (resumed) throw error;
			report_thrown('machine_queue_yield_failed', { name: this.#name }, error);
			resume();
		}
	}

	#end(): void {
		this.#state = 'idle';
		this.#pass = null;
		this.#sweep();
	}

	/** The places of the waiting jobs, highest priority first, ties in the order pushed. */
	#order(): number[] {
		const jobs = this.#jobs;
		const n = jobs.length;
		this.#at = 0;
		this.#extra = n;
		const places: number[] = [];
		const by = this.#priority;
		if (by === null) {
			for (let i = this.#head; i < n; i++) if (jobs[i] !== GONE) places.push(i);
			return places;
		}
		const ranks: number[] = [];
		let lo = Infinity;
		let hi = -Infinity;
		let whole = true;
		for (let i = this.#head; i < n; i++) {
			const job = jobs[i];
			if (job === GONE) continue;
			const r = by(job);
			const rank = r === r ? r : -Infinity;
			places.push(i);
			ranks.push(rank);
			if (rank < lo) lo = rank;
			if (rank > hi) hi = rank;
			if (whole && !Number.isInteger(rank)) whole = false;
		}
		if (places.length < 2) return places;
		if (whole && hi - lo < COUNTED_SPAN) {
			const starts: number[] = [];
			for (let s = lo; s <= hi + 1; s++) starts.push(0);
			for (const rank of ranks) starts[hi - rank + 1]++;
			for (let s = 1; s < starts.length; s++) starts[s] += starts[s - 1];
			const out = places.slice();
			for (let k = 0; k < places.length; k++) out[starts[hi - ranks[k]]++] = places[k];
			return out;
		}
		const keys = places.map((_, k) => k);
		keys.sort((a, b) => ranks[b] - ranks[a] || a - b);
		return keys.map((k) => places[k]);
	}

	/** The job at `at`, if it may start now: out of the line and started. */
	#take(at: number): boolean {
		const job = this.#jobs[at];
		if (job === GONE) return false;
		const deadline = this.#deadlines[at];
		if (deadline !== Infinity && deadline <= this.#now()) {
			this.#leave(at);
			return false;
		}
		if (this.#ready !== null && !this.#ready(job)) return false;
		let mask = 0;
		const windows = this.#windows;
		for (let w = 0; w < windows.length; w++) {
			if (!windows[w].holds(job)) continue;
			if (this.#counts[w] >= windows[w].max) return false;
			mask |= 1 << w;
		}
		this.#jobs[at] = GONE;
		this.#waiting--;
		if (deadline !== Infinity) this.#untime();
		this.#hold(job, mask);
		return true;
	}

	/** The job at `at` leaves while it waits: stale. */
	#leave(at: number): void {
		const job = this.#jobs[at] as J;
		this.#jobs[at] = GONE;
		this.#waiting--;
		if (this.#deadlines[at] !== Infinity) this.#untime();
		this.#stale_job(job);
	}

	/** A job is stale: its hook hears it. One that throws is reported, and the others still go on. */
	#stale_job(job: J): void {
		try {
			this.#stale?.(job);
		} catch (error) {
			report_thrown('machine_queue_stale_failed', { name: this.#name }, error);
		}
	}

	/** A waiting job with a deadline left: the last one takes the timer with it. */
	#untime(): void {
		if (--this.#timed > 0 || this.#disarm === null) return;
		this.#disarm();
		this.#disarm = null;
		this.#armed_at = Infinity;
	}

	/** The one timer goes off at `at` (the earliest deadline waiting). */
	#arm(at: number): void {
		this.#disarm?.();
		this.#armed_at = at;
		const timers = (this.#timers ??= this.#owner?.child() ?? scope());
		const ms = Math.min(MAX_TIMEOUT_MS, Math.max(0, at - this.#now()));
		this.#disarm = timers.timeout(() => this.#expire(), ms);
	}

	/** The deadlines that came: those jobs are stale; the timer goes on to the next one. */
	#expire(): void {
		this.#disarm = null;
		this.#armed_at = Infinity;
		const now = this.#now();
		this.#leave_where((deadline) => deadline <= now);
		let next = Infinity;
		const jobs = this.#jobs;
		for (let i = this.#head; i < jobs.length; i++)
			if (jobs[i] !== GONE && this.#deadlines[i] < next) next = this.#deadlines[i];
		if (next !== Infinity) this.#arm(next);
		if (this.#passes) this.#sweep();
		else this.#compact();
	}

	/** The waiting jobs `test` picks (by deadline) leave, stale. They are picked first and each is
	 *  found again as it leaves: a `stale` that pushes or releases may compact the list under it. */
	#leave_where(test: (deadline: number) => boolean): void {
		const picked: J[] = []; // (one per call)
		for (let i = this.#head; i < this.#jobs.length; i++) {
			const job = this.#jobs[i];
			if (job !== GONE && test(this.#deadlines[i])) picked.push(job);
		}
		for (const job of picked) {
			const at = this.#jobs.indexOf(job, this.#head);
			if (at !== -1) this.#leave(at);
		}
	}

	/** The started and gone front of the plain queue's list out, once it is the larger part. */
	#compact(): void {
		const head = this.#head;
		if (head < 32 || head * 2 < this.#jobs.length) {
			if (head === this.#jobs.length && head > 0) {
				this.#jobs.length = this.#deadlines.length = this.#head = 0;
			}
			return;
		}
		this.#jobs.splice(0, head);
		this.#deadlines.splice(0, head);
		this.#head = 0;
	}

	/** Keeps only the waiting jobs, in the order pushed. */
	#sweep(): void {
		const jobs = this.#jobs;
		if (this.#pass !== null || jobs.length === this.#waiting) return;
		const deadlines = this.#deadlines;
		if (this.#waiting === 0) {
			jobs.length = deadlines.length = 0;
			return;
		}
		let w = 0;
		for (let i = 0; i < jobs.length; i++) {
			if (jobs[i] === GONE) continue;
			jobs[w] = jobs[i];
			deadlines[w++] = deadlines[i];
		}
		jobs.length = deadlines.length = w;
	}
}

/** The most windows a queue takes (each is a bit of a started job's mask). */
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
	if (options.max !== undefined) cap('max', options.max);
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
	return new QueueImpl(options);
}
