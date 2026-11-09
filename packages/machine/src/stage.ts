/**
 * A change that takes several steps, built off to the side and then switched in with one
 * synchronous step, or thrown away whole. Live state is never half-changed.
 *
 *   const next = stage(visit, {
 *     name: 'navigation',
 *     build: async ({ signal, discard }) => {
 *       const page = await fetch_page(url, signal);
 *       const sheet = inert_sheet(page);        // a change off to the side: styles nothing yet
 *       discard(() => sheet.remove());          // taken back unless the stage commits
 *       return { page, sheet };
 *     },
 *     commit: ({ page, sheet }, undo) => {
 *       sheet.media = 'all';
 *       undo(() => (sheet.media = 'not all')); // put back if a later step of the commit throws
 *       swap_in(page);
 *     }
 *   });
 *   if ((await next.ready) === STALE) return; // the visit was left: everything built is discarded
 *   next.commit();                            // false: refused (not built, or the visit was left)
 *
 * - A stage belongs to its owner's scope. When the owner closes before the commit (a newer
 *   navigation, a refresh that took over), every `discard` step the build gave runs, newest first,
 *   and `ready` is `STALE`. A build still running then gets a closed signal, and a `discard` step it
 *   gives afterwards runs at once: a build that lands late leaves nothing behind.
 * - `commit()` runs `commit` once, synchronously, so nothing interleaves inside it. It is refused
 *   (`false`) until the build is ready, once the owner closed, and after a first commit. A commit
 *   that closes the owner itself (switching the page in moves the navigation on) is still a commit:
 *   nothing it switched in is discarded. After a commit, a `discard` step is dropped: the change is
 *   live.
 * - A `commit` that throws puts back what it already changed (its `undo` steps, newest first), then
 *   discards what the build made, and `commit()` throws its error. A build that throws discards
 *   too, and `ready` rejects with its error.
 * - A `discard` or `undo` step that throws does not stop the others; it is said once
 *   (`machine_stage_step_failed`).
 * - A stage that committed or was discarded leaves nothing on its owner.
 *
 * A stage is a machine (`building`, `built`, `committing`, then `committed` or `discarded`), and
 * its life in its owner is a child scope of the owner, closed once it ends.
 */
import { machine, type Machine } from './machine.ts';
import { machine_error, report } from './messages.ts';
import type { Scope } from './scope.ts';
import { STALE, type Stale } from './stale.ts';

/** What a build is handed: the owner's signal, and a way to give back a change it made. */
export interface Staging {
	/** Aborts when the owner closes (or once the stage ended). */
	readonly signal: AbortSignal;
	/** Runs `step` unless the stage commits: when the owner closes first, the build fails, or the
	 *  commit throws. At once when that has already happened. */
	discard(step: () => void): void;
}

export interface StageOptions<B> {
	/** Names the stage in messages. Default `stage`. */
	name?: string;
	/** Builds the change off to the side: no live writes, or only ones it gives back (`discard`). */
	build: (staging: Staging) => B | PromiseLike<B>;
	/** Switches the change in, in one synchronous step. `undo` gives back a step already taken,
	 *  should a later one throw. */
	commit: (built: B, undo: (step: () => void) => void) => void;
}

export interface Stage<B> {
	/** What the build made, once it is made; `STALE` when the owner closed first. Rejects with the
	 *  build's error. */
	readonly ready: Promise<B | Stale>;
	/** Switches the change in: true once done, false when refused (not built yet, the owner closed,
	 *  or already committed or discarded). Throws what `commit` threw, after putting it back. */
	commit(): boolean;
}

/** Where a stage is: its build out, built and waiting for the commit, its commit running, or
 *  ended (switched in, or given back). */
type StageStates = {
	building: {};
	built: { value: unknown };
	committing: {};
	committed: {};
	discarded: {};
};
const stage_machine = machine<StageStates>()({
	name: 'stage',
	initial: 'building',
	steps: {
		building: ['built', 'discarded'],
		built: ['committing', 'discarded'],
		committing: ['committed', 'discarded'],
		committed: [],
		discarded: []
	}
});

class Staged<B> implements Stage<B> {
	readonly ready: Promise<B | Stale>;
	_name: string;
	_commit: (built: B, undo: (step: () => void) => void) => void;
	_m: Machine<StageStates, typeof stage_machine.steps> = stage_machine.create();
	/** Its life in its owner: closes with the owner, and once the stage ends (so an owner that
	 *  makes many stages holds none of the ended ones). */
	_life: Scope;
	/** The build's discard steps, until the stage ends. */
	_steps: (() => void)[] = [];

	constructor(owner: Scope, o: StageOptions<B>) {
		for (const option of ['build', 'commit'] as const)
			if (typeof o[option] !== 'function')
				throw machine_error('machine_bad_option', {
					option,
					value: typeof o[option],
					rule: 'a function'
				});
		this._name = o.name ?? 'stage';
		this._commit = o.commit;
		const life = (this._life = owner.child());
		// the owner closed: what is built so far is given back, unless a commit is running (one that
		// closes its own owner switches the change in all the same)
		life.defer(() => {
			const kind = this._m.now.kind;
			if (kind === 'building' || kind === 'built') this._discard();
		});
		const staging: Staging = {
			signal: life.signal,
			discard: (step) => {
				const kind = this._m.now.kind;
				if (kind === 'discarded') run([step], this._name);
				else if (kind !== 'committed') this._steps.push(step);
				// (committed: the change is live, nothing of it is given back)
			}
		};
		this.ready = life
			.task(() => o.build(staging))
			.then(
				(built) => {
					if (built !== STALE) this._m.move('building', 'built', { value: built });
					return built;
				},
				(error: unknown) => {
					this._discard();
					throw error;
				}
			);
	}

	/** Gives back what the build made (once), and ends the stage. */
	_discard(): void {
		const kind = this._m.now.kind;
		if (kind === 'committed' || kind === 'discarded') return;
		this._m.go('discarded');
		const steps = this._steps;
		this._steps = [];
		run(steps, this._name);
		this._life.close();
	}

	commit(): boolean {
		const s = this._m.now;
		if (s.kind !== 'built' || this._life.closed) return false;
		this._m.go('committing');
		const undo: (() => void)[] = [];
		try {
			this._commit(s.value as B, (step) => void undo.push(step));
		} catch (error) {
			run(undo, this._name);
			this._discard();
			throw error;
		}
		// switched in: nothing is given back any more
		this._m.go('committed');
		this._steps = [];
		this._life.close();
		return true;
	}
}

/** Runs `steps` newest first; one that throws is said and does not stop the others. */
function run(steps: (() => void)[], name: string): void {
	for (let i = steps.length - 1; i >= 0; i--) {
		try {
			steps[i]();
		} catch (error) {
			report('machine_stage_step_failed', { name }, error);
		}
	}
}

/** A change built off to the side and switched in at once, owned by `owner` (see the module's
 *  comment). */
export function stage<B>(owner: Scope, options: StageOptions<B>): Stage<B> {
	return new Staged<B>(owner, options);
}
