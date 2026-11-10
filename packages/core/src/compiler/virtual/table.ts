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

type Source = string | Promise<string>;

interface Base {
	realm: Realm;
	/** the name under the realm: `secret` is `ogygia:server/secret` */
	id: string;
	/** the specifier it had before realms were in the name (resolves the same; step 5 drops them) */
	alias?: string;
	watch?: readonly Watch[];
}

/** A value module: `from` returns its data (JSON, plus `Set`), and the module has one named export
 *  per name in `exports` (never a default), which is also its name in the realm module. The
 *  generated `.d.ts` types each one off the entry, `ValueOf<typeof entry>['name']`. */
export interface ValueEntry<A, T extends object = Record<string, unknown>> extends Base {
	kind: 'value';
	exports: readonly (keyof T & string)[];
	from(app: A, leg: Leg): T;
}

/** Where a request module's functions live: one of core's own modules (by its path under `src/`,
 *  no extension), or a package's. The generated `.d.ts` re-exports that module's own types. */
export type RequestModule = { core: string } | { package: string };

/** A module's names in its realm module → its own export names. */
export type RealmExports<K extends string = string> = Readonly<Record<string, K>>;

export interface RequestEntry<A> extends Base {
	kind: 'request';
	realm: 'server';
	module: RequestModule;
	/** the functions it re-exports, by their name in the realm module */
	exports: RealmExports;
}

/** A generated-code module. `M` is what it exports (an interface in `contract/`): the generated
 *  `.d.ts` reads it off the entry ({@link ModuleOf}); the entry carries it as a type only. A module
 *  without `exports` only runs: it keeps its own id, and the realm module never imports it. */
export interface FamilyEntry<A, M = Record<never, never>> extends Base {
	kind: 'family';
	/** with `parse`, the entry is a prefix (`id` ends in `/`) and `parse` reads the rest; without it,
	 *  the entry is the one module named `id` */
	parse?(rest: string): string | null;
	/** the module's source; `undefined`: not this table's to load (the driver's registry is) */
	load?(app: A, leg: Leg, rest: string): Source | null;
	/** what the realm module re-exports from it, by its name there */
	exports?: RealmExports<keyof M & string>;
	/** (type only: never set) */
	readonly shape?: M;
}

/** A value entry's module type: what its `from` returns. */
export type ValueOf<E extends { from: (...a: never[]) => unknown }> = Awaited<
	ReturnType<E['from']>
>;
/** A family entry's module type: the contract interface it declares. */
export type ModuleOf<E extends { shape?: unknown }> = NonNullable<E['shape']>;

/** An entry's names in its realm module → its module's own names (none: it is not re-exported). */
export function realm_exports(e: ModuleEntry<unknown>): [string, string][] {
	if (e.kind === 'value') return e.exports.map((n: string) => [n, n]);
	return Object.entries(e.exports ?? {});
}

export interface ConstantEntry<A> {
	kind: 'constant';
	/** the `define` name */
	id: string;
	from(app: A): boolean | number | string | null;
}

// (`any`: an entry of any session or shape is one of the table's; the shapes are read per entry)
// oxlint-disable-next-line typescript/no-explicit-any
export type ModuleEntry<A> = ValueEntry<A, any> | RequestEntry<A> | FamilyEntry<A, any>;
export type Entry<A> = ModuleEntry<A> | ConstantEntry<A>;

/** The constructors. Each returns its argument, kind set, so a declaration reads as data. */
export const virtual = {
	value: <A, T extends object>(e: Omit<ValueEntry<A, T>, 'kind'>): ValueEntry<A, T> => ({
		kind: 'value',
		...e
	}),
	request: <A>(e: Omit<RequestEntry<A>, 'kind'>): RequestEntry<A> => ({ kind: 'request', ...e }),
	family: <A, M = Record<never, never>>(e: Omit<FamilyEntry<A, M>, 'kind'>): FamilyEntry<A, M> => ({
		kind: 'family',
		...e
	}),
	constant: <A>(e: Omit<ConstantEntry<A>, 'kind'>): ConstantEntry<A> => ({ kind: 'constant', ...e })
};

/** A value as module source: JSON, with each `Set` written as `new Set([…])`. */
export function write_value(v: unknown): string {
	if (v instanceof Set) return v.size ? `new Set(${JSON.stringify([...v])})` : 'new Set()';
	if (Array.isArray(v)) return `[${v.map(write_value).join(', ')}]`;
	if (v !== null && typeof v === 'object')
		return `{ ${Object.entries(v)
			.map(([k, x]) => `${JSON.stringify(k)}: ${write_value(x)}`)
			.join(', ')} }`;
	return JSON.stringify(v);
}
