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
 * A navigation the router gives the browser (./router.ts `hand_off`) is idle at once: it is the
 * browser's now, and one the browser keeps the page on screen for (a download, a 204) has no swap
 * to end it.
 *
 * Each claim is a new visit, and a visit's state value is its own object: code that awaited checks
 * `nav.now === mine` to know it is still the navigation, in place of a hand-kept generation.
 *
 * It lives here, on the boot side: the navigation chunk reaches it through the router (`r.nav`),
 * and `STALE` and the soft refresh's machine (./soft-refresh.ts) through `boot_link()`. A chunk that
 * imported `@ogygia/machine` itself would share it with the boot, and the bundler would split it
 * into a boot file of its own (./slots.ts `BootLink`).
 */
import { machine, type Machine, type MachineGraph } from '@ogygia/machine';

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

/** The navigation machine's states and steps, as data (internal/notes/flows/navigation.md draws it). */
export function navigation_graph(): MachineGraph {
	return definition.graph();
}

/** A navigation machine, idle. */
export function create_navigation(): Navigation {
	return definition.create();
}
