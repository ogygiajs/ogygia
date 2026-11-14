import { OgygiaError } from '../messages.ts';
import type { ExportIndex } from '../exports/index.ts';
import type { WalkResolve } from '../fouc-css.ts';

import { OGYGIA_SCHEME, specifier, type Realm } from './specifier.ts';

export { OGYGIA_SCHEME, specifier, type Realm };

/** A part of the session a module's `from`/`load` can read. The table records which parts each
 *  load read (through {@link Parts}); a dev change to a part reloads exactly those modules. */
export type Part = 'options' | 'regions' | 'routes' | 'plugins' | 'styles';

/** The session's fields → the part each one is (`null`: read freely, never a reason to reload). */
export type Parts<A> = Readonly<Record<keyof A & string, Part | null>>;

/** A generated module's specifier, which names no file: ogygia's (`ogygia:`) or another plugin's
 *  (`virtual:`, the convention). */
export const is_generated_specifier = (s: string): boolean =>
	s.startsWith(OGYGIA_SCHEME) || s.startsWith('virtual:');

/** An entry's specifier, which is also the id the bundler keys its module by. */
export const specifier_of = (e: { realm: Realm; id: string }): string => specifier(e.realm, e.id);

/** The build's leg a module is loaded for, and the bundler values the driver cannot see. */
export interface Leg {
	ssr: boolean;
	/** the app's universal hooks file (its `transport`), if any */
	universalHooks: string | null;
	/** the bundler's resolver */
	resolve?: (spec: string, importer: string) => Promise<string | null>;
	/** `resolve`'s export index (compiler/exports/), for a walk through barrels */
	exports?: ExportIndex<WalkResolve>;
	/** Kit 3's own codec module (`#app/internal/transport`), when the app's Kit has one */
	kitCodec?: string | null;
}

type Source = string | Promise<string>;

interface Base {
	realm: Realm;
	id: string;
}

/** A value module: `from` returns its data (JSON, plus `Set`), and the module has one named export
 *  per key of it (never a default), which is also its name in the realm module. The keys are read
 *  off a probe run at core build time ({@link ValueNames}); the generated `.d.ts` types each one off
 *  the entry, `ValueOf<typeof entry>['name']`. */
export interface ValueEntry<A, T extends object = Record<string, unknown>> extends Base {
	kind: 'value';
	from(app: A, leg: Leg): T;
}

/** Each value entry's export names, by specifier: generated at core build time from a probe run of
 *  its `from` (./value-names.ts), so the realm module knows them without running it. */
export type ValueNames = Readonly<Record<string, readonly string[]>>;

/** Where a request module's functions live: one of core's own modules (by its path under `src/`,
 *  no extension), or a package's. The generated `.d.ts` re-exports that module's own types. */
export type RequestModule = { core: string } | { package: string };

/** A module's names in its realm module → its own export names. */
export type RealmExports<K extends string = string> = Readonly<Record<string, K>>;

/** A server module of functions, so secrets and per-request things are never baked in. `_A` keeps
 *  one shape for every kind: a request reads nothing off the session. */
export interface RequestEntry<_A> extends Base {
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
export function realm_exports(e: ModuleEntry<unknown>, names: ValueNames): [string, string][] {
	if (e.kind === 'value') return value_names(e, names).map((n) => [n, n]);
	return Object.entries(e.exports ?? {});
}

/** A value entry's export names; one with none generated fails with `virtual_names_stale`. */
export function value_names(e: ValueEntry<unknown, object>, names: ValueNames): readonly string[] {
	const list = names[specifier_of(e)];
	if (!list) throw new OgygiaError('virtual_names_stale', { id: specifier_of(e) });
	return list;
}

/** A switch: a `define` the bundler inlines, so the code it gates folds out. Read at config time
 *  from `I` (the resolved options), not from a compile session: it is no module. The generated
 *  `.d.ts` declares its global as `ConstOf<typeof entry>`. */
export interface ConstantEntry<I, T extends boolean | number | string | null = boolean> {
	kind: 'constant';
	/** the `define` name */
	id: string;
	from(input: I): T;
}

/** A constant entry's type: what its `from` returns. */
export type ConstOf<E extends { from: (...a: never[]) => unknown }> = ReturnType<E['from']>;

/** The `define` map of a set of constants. */
export function defines<I>(
	// oxlint-disable-next-line typescript/no-explicit-any -- each constant's own value type; the map is strings
	constants: readonly ConstantEntry<I, any>[],
	input: I
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const c of constants) out[c.id] = JSON.stringify(c.from(input));
	return out;
}

// oxlint-disable-next-line typescript/no-explicit-any -- an entry of any session or shape is one of the table's; the shapes are read per entry
export type ModuleEntry<A> = ValueEntry<A, any> | RequestEntry<A> | FamilyEntry<A, any>;
// oxlint-disable-next-line typescript/no-explicit-any -- a constant of any input and value type is one of the table's
export type Entry<A> = ModuleEntry<A> | ConstantEntry<any, any>;

/** The constructors, one per kind: a value (build-time data), a request (a server module of
 *  functions), a family (generated code), a constant (a `define`, no module, read at config time).
 *  Each returns its argument, kind set, so a declaration reads as data. */
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
	constant: <I, T extends boolean | number | string | null>(
		e: Omit<ConstantEntry<I, T>, 'kind'>
	): ConstantEntry<I, T> => ({ kind: 'constant', ...e })
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
