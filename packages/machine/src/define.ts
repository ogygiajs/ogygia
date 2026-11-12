/**
 * Definer marking (dev): each module run owns the definitions its marked definer calls make, so a
 * reload ends the ones its code no longer makes. Its own module, apart from registry(), so a page
 * that only uses a registry does not carry it (and its install on load).
 */
import { registry, type KeyedRegistry } from './registry.ts';
import { scope, type Scope } from './scope.ts';

/** What the definer marking shares across every copy of this module a process loads: each module's
 *  run now (by id, each owned by itself), and the run whose marked call is running. */
type Defining = {
	runs: KeyedRegistry<string, Scope>;
	now: Scope | null;
	/** What core's dev transform calls at the top of a module that calls a definer. */
	run: (id: string) => <F extends (...args: never[]) => unknown>(fn: F) => F;
};
const DEFINING_KEY = Symbol.for('ogygia.define');

function defining_host(): Defining {
	const g = globalThis as { [DEFINING_KEY]?: Defining };
	return (g[DEFINING_KEY] ??= { runs: registry.keyed(), now: null, run: defineRun });
}

/**
 * A module's new run (each evaluation of it, dev): ends the run before it, and with it every
 * definition that run made, then gives the wrapper its definer calls go through, so each makes its
 * definitions under this run ({@link defining}). A definition the new run makes again is set again;
 * one deleted from the code is gone. Core's dev transform calls it at the top of each module that
 * calls a plugin's definer (`b.definers()`); in a build nothing is marked and nothing ends.
 */
export function defineRun(id: string): <F extends (...args: never[]) => unknown>(fn: F) => F {
	const host = defining_host();
	host.runs.get(id)?.close();
	const life = scope();
	host.runs.set(id, life, life);
	return <F extends (...args: never[]) => unknown>(fn: F): F =>
		((...args: Parameters<F>) => {
			const outer = host.now;
			host.now = life;
			try {
				return fn(...args);
			} finally {
				host.now = outer;
			}
		}) as F;
}

/** The module run whose marked definer call is running now, or null (a build, or an unmarked
 *  call): what a definer owns its definitions by. */
export function defining(): Scope | null {
	return defining_host().now;
}

// (installed on load: a definer imports defining(), so this runs before a marked module's body, and
// the dev transform's `globalThis[Symbol.for('ogygia.define')]?.run` finds it)
defining_host();
