/**
 * The realm-named specifiers (`ogygia:<realm>/<id>`). Import-free: `@ogygia/compiler/ids` reaches it,
 * and that subpath loads in the browser (the devtools profiler), where the compiler's messages and
 * core's node-only contract must not follow.
 */

/** Where a virtual module may run. */
export type Realm = 'server' | 'boot' | 'region' | 'dev';

/** The prefix every realm-named specifier starts with. */
export const OGYGIA_SCHEME = 'ogygia:';

/** A module's specifier: `ogygia:<realm>/<id>`. */
export const specifier = (realm: Realm, id: string): string => `${OGYGIA_SCHEME}${realm}/${id}`;
