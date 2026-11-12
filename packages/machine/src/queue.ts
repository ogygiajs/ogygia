/**
 * Work that waits for room: at most `max` jobs hold a place at once, first come, first served.
 *
 *   const renders = queue<Call>({
 *     max: 4,
 *     start: (call) => call.enter(),     // its turn: in the step its place came free
 *     stale: (call) => call.gone()       // its deadline came, it was cancelled, or the owner closed
 *   });
 *   renders.push(call, Date.now() + 5_000);
 *   signal.addEventListener('abort', () => renders.cancel(call));
 *   // … once the call's work is done:
 *   renders.release();
 *
 * - `start` starts a job in the step its place comes free: a `release` hands its place to the next
 *   job at once, so a job pushed meanwhile queues behind it instead of starting beside it. One that
 *   throws is reported (machine_queue_start_failed); the jobs after it still start.
 * - A wait never hangs. A job still waiting at its deadline (by `now`) is `stale` and never starts;
 *   one whose deadline came is passed over even before the timer runs. The deadlines share one timer,
 *   at the earliest one waiting, and it goes once none waits.
 * - `cancel(job)` makes a waiting job `stale` at once; a started one is untouched.
 * - The queue's `owner` closing makes every waiting job `stale`, and any pushed after.
 *
 * The queue keeps the jobs themselves, in the order pushed: no record per job. A start that pushes,
 * cancels or releases runs inside the drain safely: each start takes its job off the front first.
 */
import { machine_error, report_thrown } from './messages.ts';
import { clock } from './ports.ts';
import { MAX_TIMEOUT_MS, scope, type Scope } from './scope.ts';

export interface QueueOptions<J> {
	/** Names the queue in messages. */
	name?: string;
	/** The most jobs holding a place at once. */
	max: number;
	/** Starts a job: its place is its until `release()`. */
	start: (job: J) => void;
	/** Hears a job that will never start: its deadline came, it was cancelled, or the owner closed. */
	stale?: (job: J) => void;
	/** The clock deadlines are read on (ms). `clock.mono()` when left out. */
	now?: () => number;
	/** Closing it makes every waiting job stale, and any pushed after. */
	owner?: Scope;
}

export interface Queue<J> {
	/** Queues `job`, to start in turn, or to be stale at `deadline` (by the queue's `now`). */
	push(job: J, deadline?: number): void;
	/** A waiting `job` leaves at once, stale. A started one is untouched. */
	cancel(job: J): void;
	/** A started job's work is done: its place goes to the next job, in this step. */
	release(): void;
	/** Jobs waiting to start. */
	readonly waiting: number;
	/** Started jobs holding a place, not yet released. */
	readonly holding: number;
}

/** A place in the list a job left (cancelled, or past its deadline). */
const GONE: unique symbol = Symbol('gone');

class QueueImpl<J> implements Queue<J> {
	readonly #name: string;
	readonly #max: number;
	readonly #start: (job: J) => void;
	readonly #stale: ((job: J) => void) | null;
	readonly #now: () => number;
	readonly #owner: Scope | null;
	/** The jobs in the order pushed; the ones before `#head` started. */
	#jobs: Array<J | typeof GONE> = [];
	/** Each job's deadline, beside it (`Infinity`: none). */
	#deadlines: number[] = [];
	#head = 0;
	#waiting = 0;
	#holding = 0;
	/** Waiting jobs with a deadline; the one timer, armed at `#armed_at`. */
	#timed = 0;
	#armed_at = Infinity;
	#disarm: (() => void) | null = null;
	#timers: Scope | null = null;

	constructor(o: QueueOptions<J>) {
		this.#name = o.name ?? 'queue';
		this.#max = o.max;
		this.#start = o.start;
		this.#stale = o.stale ?? null;
		this.#now = o.now ?? clock.mono;
		this.#owner = o.owner ?? null;
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
		this.#drain();
		if (deadline < this.#armed_at && this.#jobs.length > this.#head) this.#arm(deadline);
	}

	cancel(job: J): void {
		const at = this.#jobs.indexOf(job, this.#head);
		if (at !== -1) this.#leave(at);
	}

	release(): void {
		if (this.#holding === 0) return;
		this.#holding--;
		this.#drain();
	}

	/** Starts jobs from the front while there is room. */
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
			try {
				this.#start(job);
			} catch (error) {
				report_thrown('machine_queue_start_failed', { name: this.#name }, error);
			}
		}
		this.#compact();
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
		this.#compact();
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

	/** The started and gone front of the list out, once it is the larger part. */
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
}

/** A bounded, first-come queue of jobs (see the module). */
export function queue<J>(options: QueueOptions<J>): Queue<J> {
	const { max } = options;
	if (!(Number.isInteger(max) && max >= 1))
		throw machine_error('machine_bad_option', {
			option: 'max',
			value: String(max),
			rule: 'a whole number of at least 1'
		});
	return new QueueImpl(options);
}
