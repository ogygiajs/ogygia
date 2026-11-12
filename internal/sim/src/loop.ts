/**
 * The run's one event loop, on virtual time. Every timer, frame, idle callback and network delivery
 * of every realm (each tab, each server) is a task here, due at a virtual millisecond. The loop runs
 * the earliest; when tasks of several realms are due at once, the seed picks which goes first, which
 * is how a run explores interleavings. Inside one realm, tasks due at once keep the order they were
 * queued in (a browser runs two equal timers in the order they were set).
 *
 * Microtasks are the platform's own: after a task's synchronous part, its promise reactions run
 * before the loop moves on. Work the simulator does not own outright (happy-dom's `setImmediate`
 * hops, a stream's internal turns, any file or crypto job) is waited out by `settle()`: real turns
 * of the host loop until the host has no real work pending at all (`process.getActiveResourcesInfo`:
 * no immediate, no file or crypto request). What remains then is waiting on the loop. A run checks
 * this by running twice and comparing the trace (cli.ts, the replay check).
 */
import type { Rng } from './rng.ts';

export interface Task {
	readonly at: number;
	readonly seq: number;
	readonly realm: string;
	readonly label: string;
	readonly run: () => void;
	cancelled: boolean;
}

export interface LoopOptions {
	/** Virtual ms past which nothing runs (a repeating timer would otherwise run forever). */
	horizon?: number;
	/** Called after each task: the oracles that are checked at every step. */
	after?: (task: Task) => void;
}

const real_set_immediate: (fn: () => void) => unknown =
	(globalThis as { setImmediate?: (fn: () => void) => unknown }).setImmediate ??
	((fn: () => void) => globalThis.setTimeout(fn, 0));

/**
 * Host resources that are not work in flight: open handles that stay (the terminal, a test
 * runner's pipe) and real timers (none of the run's own: those are loop tasks; one left is a
 * library's own clock, counted in `Loop.real_timers` so a leak shows).
 */
const AT_REST = new Set([
	'TTYWrap',
	'PipeWrap',
	'TCPWrap',
	'TCPServerWrap',
	'TCPSocketWrap',
	'UDPWrap',
	'SignalWrap',
	'ProcessWrap',
	'FSEventWrap',
	'StatWatcher',
	'MessagePort',
	'Worker',
	'Timeout'
]);

/** Most host turns one settle waits (a page spinning on `setImmediate` would wait forever). */
const MAX_TURNS = 10_000;

export class Loop {
	readonly rng: Rng;
	readonly horizon: number;
	#now = 0;
	#seq = 0;
	#tasks: Task[] = [];
	#ran = 0;
	#after: ((task: Task) => void) | undefined;
	/** Every task run, `at realm label`: what the determinism oracle compares. */
	readonly log: string[] = [];
	/** Tasks that threw. */
	readonly errors: Array<{ at: number; realm: string; label: string; error: unknown }> = [];

	constructor(rng: Rng, options: LoopOptions = {}) {
		this.rng = rng.fork('loop');
		this.horizon = options.horizon ?? 10 * 60_000;
		this.#after = options.after;
	}

	/** Virtual ms since the run began. */
	get now(): number {
		return this.#now;
	}

	/** Tasks queued and not cancelled. */
	get pending(): number {
		let n = 0;
		for (const t of this.#tasks) if (!t.cancelled) n++;
		return n;
	}

	/** When the earliest queued task is due (Infinity when none is). */
	get next_at(): number {
		let at = Infinity;
		for (const t of this.#tasks) if (!t.cancelled && t.at < at) at = t.at;
		return at;
	}

	/** The queued tasks, earliest first (a hung run's dump). */
	queued(): Task[] {
		return this.#tasks.filter((t) => !t.cancelled).sort((a, b) => a.at - b.at || a.seq - b.seq);
	}

	/** When the earliest queued task of `realm` is due (Infinity when none is). */
	next_of(realm: string): number {
		let at = Infinity;
		for (const t of this.#tasks) if (!t.cancelled && t.realm === realm && t.at < at) at = t.at;
		return at;
	}

	/** Tasks run so far. */
	get ran(): number {
		return this.#ran;
	}

	/** Queues `run` in `realm`, `ms` from now. */
	add(realm: string, label: string, ms: number, run: () => void): Task {
		const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
		const task: Task = {
			at: this.#now + delay,
			seq: this.#seq++,
			realm,
			label,
			run,
			cancelled: false
		};
		this.#tasks.push(task);
		return task;
	}

	/** Writes `line` into the log at this moment (what a run saw: an action, a page's DOM hash). */
	note(line: string): void {
		this.log.push(`${this.#now} # ${line}`);
	}

	/** Takes every queued task of `realm` out (a tab closed, a server stopped). */
	drop(realm: string): void {
		for (const t of this.#tasks) if (t.realm === realm) t.cancelled = true;
	}

	/** The next task to run: the earliest; among realms due at once, the seed's pick. */
	#next(): Task | null {
		this.#tasks = this.#tasks.filter((t) => !t.cancelled);
		if (this.#tasks.length === 0) return null;
		let at = Infinity;
		for (const t of this.#tasks) if (t.at < at) at = t.at;
		if (at > this.horizon) return null;
		// the head of each realm due now (FIFO inside a realm)
		const heads = new Map<string, Task>();
		for (const t of this.#tasks) {
			if (t.at !== at) continue;
			const h = heads.get(t.realm);
			if (h === undefined || t.seq < h.seq) heads.set(t.realm, t);
		}
		const realms = [...heads.keys()].sort();
		return heads.get(this.rng.pick(realms)) as Task;
	}

	/**
	 * Lets real work finish: host turns until the host has nothing in flight (microtasks run before
	 * each turn's immediate; another immediate, or a file or crypto request, is work in flight).
	 */
	async settle(): Promise<void> {
		for (let turn = 0; ; turn++) {
			await new Promise<void>((r) => real_set_immediate(r));
			let busy = false;
			let timers = 0;
			for (const kind of process.getActiveResourcesInfo()) {
				if (kind === 'Timeout') timers++;
				else if (!AT_REST.has(kind)) busy = true;
			}
			this.real_timers = timers;
			if (!busy) return;
			if (turn >= MAX_TURNS) {
				this.stalls++;
				return;
			}
		}
	}

	/** Real (host) timers pending at the last settle: none should be the run's. */
	real_timers = 0;
	/** Settles that gave up after MAX_TURNS (a page spinning on real immediates). */
	stalls = 0;

	/** Runs one task (and lets what it started settle). False when nothing is left before the horizon. */
	async step(): Promise<boolean> {
		await this.settle();
		const task = this.#next();
		if (task === null) return false;
		this.#tasks.splice(this.#tasks.indexOf(task), 1);
		this.#now = task.at;
		this.#ran++;
		this.log.push(`${task.at} ${task.realm} ${task.label}`);
		try {
			task.run();
		} catch (error) {
			// a task that throws is a page's uncaught error: the oracles read `errors`
			this.errors.push({ at: task.at, realm: task.realm, label: task.label, error });
		}
		await this.settle();
		this.#after?.(task);
		return true;
	}

	/** Runs until nothing is queued before `until` (virtual ms from now), or the horizon. */
	async run(until = Infinity): Promise<void> {
		const end = until === Infinity ? Infinity : this.#now + until;
		for (;;) {
			await this.settle();
			const due = this.#tasks.some((t) => !t.cancelled && t.at <= end && t.at <= this.horizon);
			if (!due) break;
			await this.step();
		}
		if (end !== Infinity && end <= this.horizon && this.#now < end) this.#now = end;
	}
}
