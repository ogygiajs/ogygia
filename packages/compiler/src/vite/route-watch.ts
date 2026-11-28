import type { Scope } from '@ogygia/machine';
import type { FileEvent } from '../kit.ts';

// @why chokidar (Vite's watcher) drops a path's `change` that comes within 50 ms of the one it reported, with no trailing event (test: test/vite-hooks.test.ts › a save the watcher reports half-written is read again once it is written)
const WATCHER_DROPS_CHANGES_MS = 50;

/**
 * DEV: what each watched file event changed in the route answers, read when the event comes and
 * once more after the watcher's quiet window, while the scope of the dev server that heard it is
 * open. A save that truncates the file and then writes it is reported at the truncate, so its first
 * read can be a write in progress. When the second read finds a change, the event the watcher
 * dropped is `replay`ed, so the dev server updates what it ran from the file as it does for any
 * event.
 */
export class RouteWatch {
	readonly #changed: (file: string, event: FileEvent) => readonly string[];
	readonly #invalidate: (id: string) => void;
	readonly #replay: (file: string) => void;

	constructor(
		changed: (file: string, event: FileEvent) => readonly string[],
		invalidate: (id: string) => void,
		replay: (file: string) => void
	) {
		this.#changed = changed;
		this.#invalidate = invalidate;
		this.#replay = replay;
	}

	/** The watcher of the dev server serving in `served` reported `event` at `file`. */
	heard(file: string, event: FileEvent, served: Scope): void {
		this.#read(file, event);
		if (event !== 'delete')
			served.timeout(() => {
				if (this.#read(file, 'update')) this.#replay(file);
			}, WATCHER_DROPS_CHANGES_MS * 2);
	}

	#read(file: string, event: FileEvent): boolean {
		const ids = this.#changed(file, event);
		for (const id of ids) this.#invalidate(id);
		return ids.length > 0;
	}
}
