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
 *
 * Both machines live here, on the boot side: the navigation chunk reaches them through the router
 * (`r.nav`) and its link (`router_link().soft`), and `STALE` through `boot_link()`. A chunk that
 * imported `@ogygia/machine` itself would share it with the boot, and the bundler would split it
 * into a boot file of its own (./slots.ts `BootLink`).
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

const soft_steps = { idle: ['refreshing'], refreshing: ['refreshing', 'idle'] } as const;

/**
 * THE SOFT REFRESH (`invalidateAll`), a machine of its own: refreshing it never cancels a real
 * click navigation, but a real navigation ends it (its answer belongs to the page being left,
 * #202), and a newer refresh supersedes it. Each refresh is a visit: its fetch is a task of it, and
 * each step after an await checks it is still `mine`.
 */
const soft_definition = machine<{ idle: {}; refreshing: { href: string } }>()({
	name: 'soft refresh',
	initial: 'idle',
	steps: soft_steps
});

/** The soft refresh machine the router holds for its navigation chunk. */
export type SoftRefresh = Machine<{ idle: {}; refreshing: { href: string } }, typeof soft_steps>;

/** A soft refresh machine, idle. */
export function create_soft_refresh(): SoftRefresh {
	return soft_definition.create();
}
