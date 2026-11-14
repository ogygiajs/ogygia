/**
 * Where a virtual module may run, named in its specifier (`ogygia:<realm>/<id>`): `server` (Node,
 * per request), `boot` (the browser runtime), `region` (inside region chunks, rendered on the
 * server too), `dev` (the dev server only).
 */
export type Realm = 'server' | 'boot' | 'region' | 'dev';

/** The prefix every realm-named specifier starts with. */
export const OGYGIA_SCHEME = 'ogygia:';

/** A module's specifier: `ogygia:<realm>/<id>`. */
export const specifier = (realm: Realm, id: string): string => `${OGYGIA_SCHEME}${realm}/${id}`;
