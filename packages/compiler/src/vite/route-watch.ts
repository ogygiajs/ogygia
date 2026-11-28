import type { Scope } from '@ogygia/machine';
import type { FileEvent } from '../kit.ts';

// @why chokidar (Vite's watcher) drops a path's `change` that comes within 50 ms of the one it reported, with no trailing event (test: test/vite-hooks.test.ts › a save the watcher reports half-written is read again once it is written)
const WATCHER_DROPS_CHANGES_MS = 50;

/** DEV: a dev server a file event is heard on, and the scope it serves in (closed when it closes). */
export interface RouteServer<S> {
	readonly scope: Scope;
	readonly server: S;
}

/**
 * DEV: what each watched file event changed in the route answers, read when the event comes and
 * once more after the watcher's quiet window, while the dev server it was heard on is open. A save
 * that truncates the file and then writes it is reported at the truncate, so its first read can be
 * a write in progress. When the second read finds a change, the event the watcher dropped is
 * `replay`ed on that server, so it updates what it ran from the file as it does for any event.
 */
export class RouteWatch<S> {
	readonly #changed: (file: string, event: FileEvent) => readonly string[];
	readonly #invalidate: (server: S, id: string) => void;
	readonly #replay: (server: S, file: string) => void;

	constructor(
		changed: (file: string, event: FileEvent) => readonly string[],
		invalidate: (server: S, id: string) => void,
		replay: (server: S, file: string) => void
	) {
		this.#changed = changed;
		this.#invalidate = invalidate;
		this.#replay = replay;
	}

	/** The watcher reported `event` at `file`, on `at` (`null`: no dev server is serving yet). */
	heard(file: string, event: FileEvent, at: RouteServer<S> | null): void {
		this.#read(file, event, at);
		if (at && event !== 'delete')
			at.scope.timeout(() => {
				if (this.#read(file, 'update', at)) this.#replay(at.server, file);
			}, WATCHER_DROPS_CHANGES_MS * 2);
	}

	#read(file: string, event: FileEvent, at: RouteServer<S> | null): boolean {
		const ids = this.#changed(file, event);
		if (at) for (const id of ids) this.#invalidate(at.server, id);
		return ids.length > 0;
	}
}
