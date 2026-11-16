/**
 * The host's file work in flight, counted by the simulator itself: `process.getActiveResourcesInfo()`
 * lists no request for some of it (Node 26 on Linux: `readFile`, promise or callback, lists nothing
 * while it reads), so a settle that read the list alone let a server's file read run past it, and
 * the loop went on to the next task, minutes of virtual time away (palaestra's /mixed: its load
 * reads package.json, and the page's navigation ran out at its 300 s deadline on CI, #1986).
 * test/core.test.ts.
 */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

/** The callback forms that read or write a whole file (each a run of requests, listed or not). */
const WHOLE_FILE: readonly string[] = ['readFile', 'writeFile', 'appendFile'];

/** The host's file work in flight, counted from when `count()` first ran (one per process). */
export class HostFileWork {
	#in_flight = 0;
	#counting = false;

	/** File work started through `node:fs` that has not ended yet. */
	get in_flight(): number {
		return this.#in_flight;
	}

	/** Counts the host's file work from now on: every promise `node:fs/promises` gives, and the
	 *  whole-file callback forms. Live ESM imports of them see the counted ones too. Idempotent. */
	count(): void {
		if (this.#counting) return;
		this.#counting = true;
		const promises = fs.promises as unknown as Record<string, unknown>;
		for (const [name, real] of Object.entries(promises)) {
			if (typeof real === 'function')
				promises[name] = this.#promised(real as (...a: unknown[]) => unknown);
		}
		const callbacks = fs as unknown as Record<string, unknown>;
		for (const name of WHOLE_FILE)
			callbacks[name] = this.#called_back(callbacks[name] as (...a: unknown[]) => unknown);
		syncBuiltinESMExports();
	}

	#promised(real: (...a: unknown[]) => unknown): (...a: unknown[]) => unknown {
		return (...a: unknown[]) => {
			const out = real(...a);
			if (!(out instanceof Promise)) return out;
			this.#in_flight++;
			return out.then(
				(value) => {
					this.#in_flight--;
					return value;
				},
				(error: unknown) => {
					this.#in_flight--;
					throw error;
				}
			);
		};
	}

	#called_back(real: (...a: unknown[]) => unknown): (...a: unknown[]) => unknown {
		return (...a: unknown[]) => {
			const done = a.at(-1);
			if (typeof done !== 'function') return real(...a);
			this.#in_flight++;
			return real(...a.slice(0, -1), (...r: unknown[]) => {
				this.#in_flight--;
				return (done as (...r: unknown[]) => unknown)(...r);
			});
		};
	}
}

/** The process's one count (the `node:fs` it wraps is the process's one module). */
export const HOST_FILE_WORK: HostFileWork = new HostFileWork();
