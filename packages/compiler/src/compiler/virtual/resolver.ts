import { OgygiaError } from '../messages.ts';
import { RESOLVED } from '../ids.ts';
import {
	OGYGIA_SCHEME,
	specifier_of,
	write_value,
	realm_exports,
	value_names,
	type Part,
	type Parts,
	type Realm,
	type ValueNames,
	type Entry,
	type FamilyEntry,
	type Leg,
	type ModuleEntry
} from './table.ts';
import { input, type Queries, type QueryCtx, type Reads } from '../queries.ts';

const PART = input<Part, number>(
	'session part',
	(part) => part,
	() => 0
);

const REALM_NAMED_IMPORT_G =
	/\b(import|export)\s*\{([^}]*)\}\s*from\s*(['"])ogygia:(server|boot|region|dev)\3;?/g;

/** Where an import is resolved: the build's leg (Vite's environment), and whether it is the dev
 *  server. */
export interface Env {
	ssr: boolean;
	dev: boolean;
}

/** The realms each leg may import: the server leg server and region, the browser leg boot and
 *  region; dev only on the dev server. */
export function realm_allowed(realm: Realm, env: Env): boolean {
	if (realm === 'region') return true;
	if (realm === 'dev') return env.dev;
	return realm === (env.ssr ? 'server' : 'boot');
}

function check_realm(id: string, realm: Realm, env: Env): void {
	if (!realm_allowed(realm, env))
		throw new OgygiaError('virtual_wrong_realm', {
			id,
			realm,
			leg: env.ssr ? 'server' : 'browser'
		});
}

/** Is this specifier (or resolved id) in ogygia's virtual namespace? */
export const is_virtual_specifier = (source: string): boolean =>
	source.startsWith(OGYGIA_SCHEME) || source.startsWith(`\0${OGYGIA_SCHEME}`);

/** The one resolver over the virtual-module table: a specifier → its resolved id, a resolved id →
 *  its source, and a dev change → the modules it invalidates. */
export class VirtualTable<A> {
	/** specifier or alias → its one-module entry */
	readonly #single = new Map<string, ModuleEntry<A>>();
	/** resolved id → its one-module entry */
	readonly #by_resolved = new Map<string, ModuleEntry<A>>();
	/** prefix → its family (prefixes never nest) */
	readonly #prefixes: [string, FamilyEntry<A>][] = [];
	/** a core module (its path under `src/`, no extension) → the built file the bundler imports */
	readonly #core_path: (app: A, module: string) => string;

	/** each value entry's export names (generated: ./value-names.ts) */
	readonly #names: ValueNames;
	/** the session's fields → the part each one is */
	readonly #parts: Parts<A>;
	/** the session's queries: a load is a reader of them (`watch`), the parts among them */
	readonly #db: Queries;
	/** resolved id and leg → what that leg's last load read: one id is loaded on both legs and can
	 *  read different things on each (bounded by the modules the table serves, twice) */
	readonly #reads = new Map<string, { id: string; reads: Reads }>();

	constructor(
		entries: readonly Entry<A>[],
		core_path: (app: A, module: string) => string,
		names: ValueNames,
		parts: Parts<A>,
		db: Queries
	) {
		this.#core_path = core_path;
		this.#names = names;
		this.#parts = parts;
		this.#db = db;
		for (const e of entries) {
			if (e.kind === 'constant') continue;
			const spec = specifier_of(e);
			const taken = this.#single.has(spec) || this.#prefixes.some(([p]) => p === spec);
			if (taken) throw new OgygiaError('virtual_duplicate', { id: spec });
			if (e.kind === 'family' && e.parse) this.#prefixes.push([spec, e]);
			else {
				this.#single.set(spec, e);
				this.#by_resolved.set(RESOLVED(spec), e);
			}
			const names = (this.#realms[e.realm] ??= new Map());
			for (const [name, own] of realm_exports(e, this.#names)) {
				if (names.has(name))
					throw new OgygiaError('virtual_duplicate', { id: `${e.realm}:${name}` });
				names.set(name, [own, specifier_of(e)]);
			}
		}
	}

	/** realm → its realm module's names → [the entry module's own name, the entry module's id] */
	readonly #realms: Partial<Record<Realm, Map<string, [string, string]>>> = {};

	/** The realm a realm module's specifier (`ogygia:server`) or resolved id names, or null. */
	#realm_of(id: string): Realm | null {
		const bare = id.startsWith('\0') ? id.slice(1) : id;
		if (!bare.startsWith(OGYGIA_SCHEME)) return null;
		const realm = bare.slice(OGYGIA_SCHEME.length) as Realm;
		return this.#realms[realm] ? realm : null;
	}

	/** A realm module's source: one named re-export per name, from the module that has it. */
	#realm_source(realm: Realm): string {
		const by_module = new Map<string, string[]>();
		for (const [name, [own, module]] of this.#realms[realm]!) {
			const list = by_module.get(module) ?? [];
			list.push(own === name ? name : `${own} as ${name}`);
			by_module.set(module, list);
		}
		const rank = (module: string): number => {
			const kind = this.#by_resolved.get(RESOLVED(module))?.kind;
			return kind === 'value' ? 0 : kind === 'request' ? 2 : 1;
		};
		return [...by_module]
			.sort(([a], [b]) => rank(a) - rank(b))
			.map(([module, names]) => `export { ${names.join(', ')} } from ${JSON.stringify(module)};`)
			.join('\n');
	}

	/**
	 * A specifier → its resolved id. `undefined`: not a table id, or a family whose ids the driver
	 * resolves itself (an island's entry, a registry stub). An id in the namespace that nothing
	 * declares fails here with `virtual_unknown`.
	 */
	resolve(source: string, env?: Env): string | undefined {
		if (source.startsWith('\0'))
			return this.#realm_of(source) || this.#by_resolved.has(source) ? source : undefined;
		const realm = this.#realm_of(source);
		if (realm) {
			if (env) check_realm(source, realm, env);
			return RESOLVED(source);
		}
		const single = this.#single.get(source);
		if (single) {
			if (single.kind === 'family' && !single.load) return undefined;
			if (env) check_realm(source, single.realm, env);
			return RESOLVED(source);
		}
		const family = this.#family_of(source);
		if (family) {
			if (env) check_realm(source, family.realm, env);
			return family.load ? RESOLVED(source) : undefined;
		}
		const q = source.indexOf('?');
		if (is_virtual_specifier(source) && !(q !== -1 && this.claims(source.slice(0, q))))
			throw new OgygiaError('virtual_unknown', { id: source });
		return undefined;
	}

	/** Does a family claim this specifier (resolved or not)? */
	claims(source: string): boolean {
		const bare = source.startsWith('\0') ? source.slice(1) : source;
		return this.#single.has(bare) || this.#family_of(bare) !== undefined;
	}

	#family_of(source: string): FamilyEntry<A> | undefined {
		for (const [prefix, family] of this.#prefixes) {
			if (source.startsWith(prefix) && family.parse!(source.slice(prefix.length)) !== null)
				return family;
		}
		return undefined;
	}

	/** A resolved id → its module source; `null`: not a module this table loads. Records what the
	 *  load read (the session's parts, and every query it read), for {@link moved}. */
	load(id: string, app: A, leg: Leg): string | Promise<string> | null {
		const key = `${leg.ssr ? 'ssr' : 'client'} ${id}`;
		const { value, reads } = this.#db.watch((cx) =>
			this.#load(id, tracked(app, this.#parts, cx), leg)
		);
		if (value === null) this.#reads.delete(key);
		else this.#reads.set(key, { id, reads });
		return value;
	}

	/** A dev change to `part` (one not yet a query: the registry, the marks, the routes, ...). */
	move(part: Part): void {
		this.#db.set(PART, part, this.#db.revision + 1);
	}

	/**
	 * Every module that something its last load read has changed under, which the caller
	 * invalidates: a part that moved, or a query whose answer is different now. Each is named once;
	 * its next load records its reads afresh.
	 */
	moved(): string[] {
		const out = new Set<string>();
		for (const [key, { id, reads }] of this.#reads) {
			if (!this.#db.moved(reads)) continue;
			out.add(id);
			this.#reads.delete(key);
		}
		return [...out];
	}

	#load(id: string, app: A, leg: Leg): string | Promise<string> | null {
		const realm = this.#realm_of(id);
		if (realm) return this.#realm_source(realm);
		const e = this.#by_resolved.get(id);
		if (e) {
			if (e.kind === 'value') {
				const data = e.from(app, leg) as Record<string, unknown>;
				const names = value_names(e, this.#names);
				const keys = Object.keys(data);
				let same = keys.length === names.length;
				for (const k of keys) same &&= names.includes(k);
				if (!same) throw new OgygiaError('virtual_names_stale', { id: specifier_of(e) });
				return names.map((name) => `export const ${name} = ${write_value(data[name])};`).join('\n');
			}
			if (e.kind === 'request') {
				const from = 'core' in e.module ? this.#core_path(app, e.module.core) : e.module.package;
				const names = [...new Set(Object.values(e.exports))];
				return `export { ${names.join(', ')} } from ${JSON.stringify(from)};`;
			}
			return e.load?.(app, leg, '') ?? null;
		}
		if (!id.startsWith('\0')) return null;
		const bare = id.slice(1);
		for (const [prefix, family] of this.#prefixes) {
			if (family.load && bare.startsWith(prefix))
				return family.load(app, leg, bare.slice(prefix.length));
		}
		return null;
	}

	/**
	 * A module's named imports of a realm module, rewritten to import each name from the entry
	 * module that has it: `import { regionTtl, sign } from 'ogygia:server'` becomes one import per
	 * entry. The realm module is the API; the bundler's graph keeps one edge per entry, so what a
	 * page ships (its chunks and their contents) is decided by the names it uses, never by the realm
	 * module's other entries. `null`: nothing to rewrite. (`import *` keeps the realm module.)
	 */
	split_realm_imports(code: string): string | null {
		if (!code.includes(OGYGIA_SCHEME)) return null;
		let changed = false;
		const out = code.replace(
			REALM_NAMED_IMPORT_G,
			(whole, kw: string, list: string, quote: string, realm: string) => {
				const names = this.#realms[realm as Realm];
				if (!names) return whole;
				const by_module = new Map<string, string[]>();
				for (const part of list.split(',')) {
					const spec = part.trim();
					if (!spec) continue;
					const [name, local = name] = spec.split(/\s+as\s+/);
					const found = names.get(name);
					if (!found) return whole;
					const [own, module] = found;
					const list_for = by_module.get(module) ?? [];
					list_for.push(own === local ? own : `${own} as ${local}`);
					by_module.set(module, list_for);
				}
				changed = true;
				return [...by_module]
					.map(([module, l]) => `${kw} { ${l.join(', ')} } from ${quote}${module}${quote};`)
					.join(' ');
			}
		);
		return changed ? out : null;
	}

	/**
	 * THE BUNDLE CHECK: every module of one leg's output that is a table module of a realm the leg
	 * may not hold, as `[id, realm]`. Reads the finished graph, so a module reached through a
	 * re-export (laundered past the resolve check) is caught too.
	 */
	misplaced(module_ids: Iterable<string>, env: Env): [string, Realm][] {
		const out: [string, Realm][] = [];
		for (const id of module_ids) {
			const realm =
				this.#realm_of(id) ?? this.#by_resolved.get(id)?.realm ?? this.#prefix_realm(id);
			if (realm && !realm_allowed(realm, env)) out.push([id, realm]);
		}
		return out;
	}

	#prefix_realm(id: string): Realm | undefined {
		if (!id.startsWith('\0')) return undefined;
		for (const [prefix, family] of this.#prefixes)
			if (id.startsWith(prefix, 1)) return family.realm;
		return undefined;
	}

	/** Is the module only definitions (a realm module, or an entry it re-exports from)? The bundler
	 *  may then drop it, and what it imports, when none of its names is used. */
	side_effect_free(id: string): boolean {
		if (this.#realm_of(id)) return true;
		const e = this.#by_resolved.get(id);
		return e !== undefined && realm_exports(e, this.#names).length > 0;
	}
}

function tracked<A>(app: A, parts: Parts<A>, cx: QueryCtx): A {
	if (typeof app !== 'object' || app === null) return app;
	return new Proxy(app, {
		get(target, key) {
			const part = typeof key === 'string' ? parts[key as keyof A & string] : undefined;
			if (part) cx.get(PART, part);
			const v: unknown = Reflect.get(target, key);
			return typeof v === 'function' ? v.bind(target) : v;
		}
	});
}
