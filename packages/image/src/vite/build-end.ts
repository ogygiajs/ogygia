/**
 * The build's end: the one moment after the prerender and before the adapter, when the build makes
 * every file a prerendered page names and points the pages at them (./build-files.ts).
 *
 * Where it falls depends on who builds the legs (each bundler environment's build):
 * - Vite, after every app build hook (`buildApp`) has run, or a single `vite.build()`: Kit 2
 *   prerenders inside its server leg's `writeBundle` and adapts in its `closeBundle`, so the end is
 *   the server leg's own `writeBundle` (`order: 'post'`), right after Kit's;
 * - an app build hook: Kit 3 builds every leg and prerenders inside its own `buildApp`, then adapts
 *   in a later one (`order: 'post'`, listed after this plugin), so the end waits for this plugin's
 *   last `buildApp`, which runs between the two;
 * - a watch rebuild of legs an app build hook built: Kit 3 rebuilds, prerenders and adapts straight
 *   from its watcher, after every plugin hook, so no hook falls between its prerender and its
 *   adapter. The end runs as the server leg is written, before the prerender, and is late: the
 *   prerender names only files a build has made, found by what the last end named them by, and
 *   fails on any other (`image_watch_rebuild`). Each rebuild's end is a run of its own: it starts
 *   once every earlier end is over.
 *
 * A new app build starts fresh whatever state the last one left (a failed build runs no last hook).
 *
 * @packageDocumentation
 */
import { machine, STALE } from '@ogygia/machine';

/** What a build's end leaves a later rebuild to find its files by: the source id each file was named
 *  by in place of the one a page names (a remote image's bytes', a card's shown images'), by that
 *  one (../handoff.ts `BuildHandoff.renamed`). */
export type Named = Readonly<Record<string, string>>;

/** The build's end: makes the files, then points the prerendered pages at them, and gives back what
 *  names them. `last` is the last build's, when it runs before the prerender (a watch rebuild of
 *  legs an app build hook built): the pages find the last build's files by it. */
export type End = (last: Named | null) => Promise<Named>;

type EndStates = {
	outside: {};
	inside: {};
	waiting: { end: End; watched: boolean };
	ending: {};
	watching: { last: Named };
	rebuilding: { last: Named };
};

const END_STEPS = {
	outside: ['inside'],
	inside: ['inside', 'waiting', 'outside'],
	waiting: ['inside', 'outside', 'ending'],
	ending: ['inside', 'watching'],
	watching: ['inside', 'rebuilding'],
	rebuilding: ['inside', 'watching']
} as const;

const END = machine<EndStates>()({ name: 'image build end', initial: 'outside', steps: END_STEPS });

export class BuildEnd {
	readonly #life = END.create();

	/** The app build hooks start (this plugin's first `buildApp`), fresh whatever the last build
	 *  left. */
	open(): void {
		this.#life.go('inside');
	}

	/** The server leg was written (`watched` under `vite build --watch`): its end runs now, or once
	 *  the app build hooks reach their last, or, for a watch rebuild of legs they built, late, once
	 *  every earlier end is over. */
	async written(end: End, watched: boolean): Promise<void> {
		if (this.#life.move('inside', 'waiting', { end, watched })) return;
		for (;;) {
			const now = this.#life.now;
			if (now.kind === 'watching') return this.#rebuilt(end, now.last);
			if (
				now.kind !== 'ending' &&
				now.kind !== 'rebuilding' &&
				!(now.kind === 'waiting' && now.watched)
			) {
				await end(null);
				return;
			}
			if ((await this.#life.wait('watching')) === STALE) return;
		}
	}

	async #rebuilt(end: End, last: Named): Promise<void> {
		this.#life.go('rebuilding', { last });
		let named = last;
		try {
			named = await end(last);
		} finally {
			this.#life.move('rebuilding', 'watching', { last: named });
		}
	}

	/** The app build hooks reach this plugin's last `buildApp`: a waiting end runs now, and a watched
	 *  build's rebuilds come after it. */
	async close(): Promise<void> {
		const now = this.#life.now;
		if (now.kind === 'inside') this.#life.go('outside');
		if (now.kind !== 'waiting') return;
		if (!now.watched) {
			this.#life.go('outside');
			await now.end(null);
			return;
		}
		this.#life.go('ending');
		let last: Named = {};
		try {
			last = await now.end(null);
		} finally {
			this.#life.move('ending', 'watching', { last });
		}
	}
}
