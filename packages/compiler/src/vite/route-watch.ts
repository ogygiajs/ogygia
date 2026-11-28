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
 * once more after the watcher's quiet window, while the dev server it was heard on is open. The
 * answers are the program's, read once for every server, so each change is `invalidate`d on every
 * open dev server. A save that truncates the file and then writes it is reported at the truncate,
 * so its first read can be a write in progress. When any read finds a change, the event a watcher
 * may have dropped is `replay`ed on every open server that heard the file before and has not read
 * it again yet, so each updates what it ran from the file as it does for any event: the read is
 * shared, so another server's read can be the one that sees the change.
 */
export class RouteWatch<S> {
	readonly #changed: (file: string, event: FileEvent) => readonly string[];
	readonly #invalidate: (id: string) => void;
	readonly #replay: (server: S, file: string) => void;
	readonly #awaiting = new Map<string, Set<RouteServer<S>>>();

	constructor(
		changed: (file: string, event: FileEvent) => readonly string[],
		invalidate: (id: string) => void,
		replay: (server: S, file: string) => void
	) {
		this.#changed = changed;
		this.#invalidate = invalidate;
		this.#replay = replay;
	}

	/** The watcher reported `event` at `file`, on `at` (`null`: no dev server is serving yet). */
	heard(file: string, event: FileEvent, at: RouteServer<S> | null): void {
		if (this.#read(file, event) && event !== 'delete') this.#found(file, at);
		if (!at || event === 'delete') return;
		const awaiting = this.#awaiting.get(file) ?? new Set<RouteServer<S>>();
		this.#awaiting.set(file, awaiting.add(at));
		at.scope.timeout(() => {
			if (this.#read(file, 'update')) this.#found(file, null);
			else if (awaiting.delete(at) && awaiting.size === 0) this.#awaiting.delete(file);
		}, WATCHER_DROPS_CHANGES_MS * 2);
	}

	/** DEV: `at` has closed; it awaits no second read and is replayed on no more. */
	forget(at: RouteServer<S>): void {
		for (const [file, awaiting] of this.#awaiting)
			if (awaiting.delete(at) && awaiting.size === 0) this.#awaiting.delete(file);
	}

	/** A read found `file` changed: every server still awaiting it heard it before, so is replayed (`heard`: the one that just reported it, not replayed). */
	#found(file: string, heard: RouteServer<S> | null): void {
		const awaiting = this.#awaiting.get(file);
		if (!awaiting) return;
		this.#awaiting.delete(file);
		const replay = [...awaiting];
		awaiting.clear();
		for (const s of replay) if (s !== heard) this.#replay(s.server, file);
	}

	#read(file: string, event: FileEvent): boolean {
		const ids = this.#changed(file, event);
		for (const id of ids) this.#invalidate(id);
		return ids.length > 0;
	}
}
