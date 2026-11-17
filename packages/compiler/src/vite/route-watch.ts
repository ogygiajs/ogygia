import type { Scope } from '@ogygia/machine';
import type { FileEvent } from '../kit.ts';

// @why chokidar (Vite's watcher) drops a path's `change` that comes within 50 ms of the one it reported, with no trailing event (test: test/vite-hooks.test.ts › a save the watcher reports half-written is read again once it is written)
const WATCHER_DROPS_CHANGES_MS = 50;

/**
 * DEV: what each watched file event changed in the route answers, read when the event comes and
 * once more after the watcher's quiet window, while `owner` is open. A save that truncates the file
 * and then writes it is reported at the truncate, so its first read can be a write in progress.
 */
export class RouteWatch {
	readonly #owner: Scope;
	readonly #changed: (file: string, event: FileEvent) => readonly string[];
	readonly #invalidate: (id: string) => void;

	constructor(
		owner: Scope,
		changed: (file: string, event: FileEvent) => readonly string[],
		invalidate: (id: string) => void
	) {
		this.#owner = owner;
		this.#changed = changed;
		this.#invalidate = invalidate;
	}

	/** The watcher reported `event` at `file`. */
	heard(file: string, event: FileEvent): void {
		this.#read(file, event);
		if (event !== 'delete')
			this.#owner.timeout(() => this.#read(file, 'update'), WATCHER_DROPS_CHANGES_MS * 2);
	}

	#read(file: string, event: FileEvent): void {
		for (const id of this.#changed(file, event)) this.#invalidate(id);
	}
}
