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
 * so its first read can be a write in progress. When a second read finds a change, the event the
 * watcher dropped is `replay`ed on every still-open server that heard the file and has not read it
 * again yet, so each updates what it ran from the file as it does for any event: the read is shared,
 * so only the first server's second read can see the change.
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
		this.#read(file, event);
		if (!at || event === 'delete') return;
		const awaiting = this.#awaiting.get(file) ?? new Set<RouteServer<S>>();
		for (const s of awaiting) if (s.scope.closed) awaiting.delete(s);
		this.#awaiting.set(file, awaiting.add(at));
		at.scope.timeout(() => {
			const changed = this.#read(file, 'update');
			const replay = changed ? [...awaiting] : [];
			if (changed) awaiting.clear();
			else awaiting.delete(at);
			if (awaiting.size === 0 && this.#awaiting.get(file) === awaiting) this.#awaiting.delete(file);
			for (const s of replay) if (!s.scope.closed) this.#replay(s.server, file);
		}, WATCHER_DROPS_CHANGES_MS * 2);
	}

	#read(file: string, event: FileEvent): boolean {
		const ids = this.#changed(file, event);
		for (const id of ids) this.#invalidate(id);
		return ids.length > 0;
	}
}
