/**
 * THE WATCHDOG'S JUDGEMENT: a run is hung once its loop has run no task for `quiet_ms` of real
 * time (a wait nobody will ever end: the simulator's, or the app's). A run that is slow but still
 * running tasks is never hung: how fast the host is would then decide a seed's result, and the two
 * runs of one seed would differ (test/watchdog.test.ts).
 */
export class Watchdog {
	readonly #quiet_ms: number;
	/** Tasks the loop had run when last asked (-1: no world, no loop yet). */
	#seen = -1;
	#since: number;

	constructor(quiet_ms: number, now: number) {
		this.#quiet_ms = quiet_ms;
		this.#since = now;
	}

	/** Whether the run is hung at real time `now` (ms), its loop having run `ran` tasks so far
	 *  (-1 before its world has a loop). */
	hung(ran: number, now: number): boolean {
		if (ran !== this.#seen) {
			this.#seen = ran;
			this.#since = now;
		}
		return now - this.#since >= this.#quiet_ms;
	}
}
