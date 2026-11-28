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
 *   adapter. The end runs as the server leg is written, before the prerender, and is `late`: the
 *   prerender names only files the build has made, and fails on any other (`image_watch_rebuild`).
 *
 * A new app build starts fresh whatever state the last one left (a failed build runs no last hook).
 *
 * @packageDocumentation
 */
import { machine } from '@ogygia/machine';

/** The build's end: makes the files, then points the prerendered pages at them. `late` when it runs
 *  before the prerender (a watch rebuild of legs an app build hook built). */
export type End = (late: boolean) => Promise<void>;

type EndStates = {
	outside: {};
	inside: {};
	waiting: { end: End; watched: boolean };
	watching: {};
};

const END_STEPS = {
	outside: ['inside'],
	inside: ['inside', 'waiting', 'outside'],
	waiting: ['inside', 'outside', 'watching'],
	watching: ['inside']
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
	 *  the app build hooks reach their last. */
	async written(end: End, watched: boolean): Promise<void> {
		if (this.#life.move('inside', 'waiting', { end, watched })) return;
		await end(this.#life.now.kind === 'watching');
	}

	/** The app build hooks reach this plugin's last `buildApp`: a waiting end runs now, and a watched
	 *  build's rebuilds come after. */
	async close(): Promise<void> {
		const now = this.#life.now;
		if (now.kind === 'inside') this.#life.go('outside');
		if (now.kind !== 'waiting') return;
		this.#life.go(now.watched ? 'watching' : 'outside');
		await now.end(false);
	}
}
