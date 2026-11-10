/**
 * THE VIRTUAL-MODULE TABLE: every module ogygia serves that is not a file is declared once, beside
 * the code that knows its value, under the realm that may import it. The realm is in the specifier,
 * `ogygia:<realm>/<id>`, and one resolver (./resolver.ts) answers every id from the table.
 *
 *   server  `ogygia:server/…`  Node, per request
 *   boot    `ogygia:boot/…`    the browser runtime
 *   region  `ogygia:region/…`  inside region chunks (rendered on the server too)
 *   dev     `ogygia:dev/…`     the dev server only
 *
 * Four kinds, one constructor each:
 *   value     build-time data, written out as `export const` lines
 *   request   a server module of functions (secrets and per-request things are never baked in)
 *   family    generated code: one module (no `parse`), or every id under a prefix
 *   constant  an on/off switch, a `define` (not a module), so dead code folds out
 */

/** Where a virtual module may run. */
export type Realm = 'server' | 'boot' | 'region' | 'dev';

/** What a module depends on in dev: a change to one of them invalidates every entry watching it. */
export type Watch = 'options' | 'regions' | 'routes' | 'plugins' | 'styles';

/** The prefix every realm-named specifier starts with. */
export const OGYGIA_SCHEME = 'ogygia:';
/** The prefix of the specifiers before realms were in the name (kept as aliases while code moves). */
export const LEGACY_PREFIX = 'virtual:ogygia/';

/** A module's specifier: `ogygia:<realm>/<id>`. */
export const specifier = (realm: Realm, id: string): string => `${OGYGIA_SCHEME}${realm}/${id}`;

/** The build's leg a module is loaded for, and the bundler values the driver cannot see. */
export interface Leg {
	ssr: boolean;
	/** the app's universal hooks file (its `transport`), if any */
	universalHooks: string | null;
	/** the bundler's resolver */
	resolve?: (spec: string, importer: string) => Promise<string | null>;
	/** Kit 3's own codec module (`#app/internal/transport`), when the app's Kit has one */
	kitCodec?: string | null;
}

/** A value module's exports: JSON, plus `Set` (written as `new Set([…])`). */
export type Exports = Record<string, unknown>;

type Source = string | Promise<string>;

interface Base {
	realm: Realm;
	/** the name under the realm: `secret` is `ogygia:server/secret` */
	id: string;
	/** the specifier it had before realms were in the name (resolves the same; step 5 drops them) */
	alias?: string;
	watch?: readonly Watch[];
	/** the module's declarations, as a `.d.ts` body (absent: it exports nothing, it only runs); the
	 *  per-realm `.d.ts` files are generated from them (scripts/virtual-types.ts) */
	types?: string;
}

export interface ValueEntry<A> extends Base {
	kind: 'value';
	from(app: A, leg: Leg): Exports;
}

export interface RequestEntry<A> extends Base {
	kind: 'request';
	realm: 'server';
	/** the module the functions come from (absolute path or a package id); `null`: not available */
	module(app: A): string | null;
	/** the functions it re-exports */
	exports: readonly string[];
	/** what the browser leg gets until the resolve check keeps server modules off it */
	client?(app: A): string;
}

export interface FamilyEntry<A> extends Base {
	kind: 'family';
	/** with `parse`, the entry is a prefix (`id` ends in `/`) and `parse` reads the rest; without it,
	 *  the entry is the one module named `id` */
	parse?(rest: string): string | null;
	/** the module's source; `undefined`: not this table's to load (the driver's registry is) */
	load?(app: A, leg: Leg, rest: string): Source | null;
}

export interface ConstantEntry<A> {
	kind: 'constant';
	/** the `define` name */
	id: string;
	from(app: A): boolean | number | string | null;
}

export type ModuleEntry<A> = ValueEntry<A> | RequestEntry<A> | FamilyEntry<A>;
export type Entry<A> = ModuleEntry<A> | ConstantEntry<A>;

/** The constructors. Each returns its argument, kind set, so a declaration reads as data. */
export const virtual = {
	value: <A>(e: Omit<ValueEntry<A>, 'kind'>): ValueEntry<A> => ({ kind: 'value', ...e }),
	request: <A>(e: Omit<RequestEntry<A>, 'kind'>): RequestEntry<A> => ({ kind: 'request', ...e }),
	family: <A>(e: Omit<FamilyEntry<A>, 'kind'>): FamilyEntry<A> => ({ kind: 'family', ...e }),
	constant: <A>(e: Omit<ConstantEntry<A>, 'kind'>): ConstantEntry<A> => ({ kind: 'constant', ...e })
};

const write_value = (v: unknown): string =>
	v instanceof Set
		? v.size
			? `new Set(${JSON.stringify([...v])})`
			: 'new Set()'
		: JSON.stringify(v);

/** A value entry's module source: one `export const` per key (`default` is the default export). */
export function write_exports(exports: Exports): string {
	return Object.entries(exports)
		.map(([k, v]) =>
			k === 'default'
				? `export default ${write_value(v)};`
				: `export const ${k} = ${write_value(v)};`
		)
		.join('\n');
}
