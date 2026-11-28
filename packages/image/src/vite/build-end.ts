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
 *   last `buildApp`, which runs between the two.
 *
 * @packageDocumentation
 */
import { machine } from '@ogygia/machine';

type EndStates = {
	/** no app build hook is running: a leg's end is the build's */
	outside: {};
	/** the app build hooks are running, and the legs may build inside them */
	inside: {};
	/** the server leg was written inside them: its end waits for the last one */
	waiting: { end: () => Promise<void> };
};

const END_STEPS = {
	outside: ['inside'],
	inside: ['waiting', 'outside'],
	waiting: ['outside']
} as const;

const END = machine<EndStates>()({ name: 'image build end', initial: 'outside', steps: END_STEPS });

export class BuildEnd {
	readonly #life = END.create();

	/** The app build hooks start (this plugin's first `buildApp`). */
	open(): void {
		this.#life.go('inside');
	}

	/** The server leg was written: its end runs now, or once the app build hooks reach their last. */
	async written(end: () => Promise<void>): Promise<void> {
		if (this.#life.move('inside', 'waiting', { end })) return;
		await end();
	}

	/** The app build hooks reach this plugin's last `buildApp`: a waiting end runs now. */
	async close(): Promise<void> {
		const now = this.#life.now;
		if (now.kind === 'outside') return;
		this.#life.go('outside');
		if (now.kind === 'waiting') await now.end();
	}
}
