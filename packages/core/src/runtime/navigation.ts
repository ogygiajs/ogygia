/**
 * THE SPA NAVIGATION'S LIFECYCLE, one machine (`@ogygia/machine`): the router's (./router.ts) and the
 * navigation chunk's (./router-nav.ts) one shared view of the navigation in flight.
 *
 *   idle ─ claimed ─ loading ─ settling ─ idle
 *            ↑ every state but idle steps to `claimed` again: a newer click takes over
 *
 * - claimed {href}: the click, while the navigation chunk loads (a web-component link's re-dispatched
 *   click sees it and is swallowed);
 * - loading {href}: the page's fetch through its swap (its fetch is a task: a newer click aborts it);
 * - settling {href}: swapped; scroll, focus and the after hooks run. A same-address click now is a
 *   refresh, not a duplicate.
 *
 * Each claim is a new visit, and a visit's state value is its own object: code that awaited checks
 * `nav.now === mine` to know it is still the navigation, in place of a hand-kept generation.
 */
import { machine, type Machine } from '@ogygia/machine';

type States = {
	idle: {};
	claimed: { href: string };
	loading: { href: string };
	settling: { href: string };
};

const steps = {
	idle: ['claimed'],
	claimed: ['claimed', 'loading', 'idle'],
	loading: ['claimed', 'settling', 'idle'],
	settling: ['claimed', 'idle']
} as const;

const definition = machine<States>()({ name: 'navigation', initial: 'idle', steps });

/** The navigation machine the router holds. */
export type Navigation = Machine<States, typeof steps>;

/** A navigation machine, idle. */
export function create_navigation(): Navigation {
	return definition.create();
}
