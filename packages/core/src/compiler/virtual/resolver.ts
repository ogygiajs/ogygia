/**
 * THE ONE RESOLVER over the virtual-module table (./table.ts): a specifier (or its legacy alias) →
 * the resolved id, a resolved id → its source, and a dev change → the modules it invalidates.
 */
import { OgygiaError } from '../../messages/build.ts';
import { RESOLVED } from '../ids.ts';
import {
	LEGACY_PREFIX,
	OGYGIA_SCHEME,
	specifier,
	write_value,
	realm_exports,
	type Realm,
	type ConstantEntry,
	type Entry,
	type FamilyEntry,
	type Leg,
	type ModuleEntry,
	type Watch
} from './table.ts';

/** The specifiers an entry answers to: its realm-named one, and its alias. */
const names_of = (e: ModuleEntry<unknown>): string[] =>
	e.alias ? [specifier(e.realm, e.id), e.alias] : [specifier(e.realm, e.id)];

/** The id the bundler keys an entry's module by (the alias while one exists: the output does not move). */
const key_of = (e: ModuleEntry<unknown>): string => e.alias ?? specifier(e.realm, e.id);

/** A static named import of a realm module (`import { a, b as c } from 'ogygia:server'`). */
const REALM_IMPORT_G =
	/\b(import|export)\s*\{([^}]*)\}\s*from\s*(['"])ogygia:(server|boot|region|dev)\3;?/g;

/** Is this specifier in ogygia's virtual namespace (the realm-named one or the legacy one)? */
export const is_virtual_specifier = (source: string): boolean =>
	source.startsWith(OGYGIA_SCHEME) || source.startsWith(LEGACY_PREFIX);

export class VirtualTable<A> {
	/** specifier or alias → its one-module entry */
	readonly #single = new Map<string, ModuleEntry<A>>();
	/** resolved id → its one-module entry */
	readonly #by_resolved = new Map<string, ModuleEntry<A>>();
	/** prefix → its family (prefixes never nest) */
	readonly #prefixes: [string, FamilyEntry<A>][] = [];
	readonly constants: readonly ConstantEntry<A>[];
	/** a core module (its path under `src/`, no extension) → the built file the bundler imports */
	readonly #core_path: (app: A, module: string) => string;

	constructor(entries: readonly Entry<A>[], core_path: (app: A, module: string) => string) {
		this.#core_path = core_path;
		const constants: ConstantEntry<A>[] = [];
		for (const e of entries) {
			if (e.kind === 'constant') {
				constants.push(e);
				continue;
			}
			for (const name of names_of(e)) {
				const taken = this.#single.has(name) || this.#prefixes.some(([p]) => p === name);
				if (taken) throw new OgygiaError('virtual_duplicate', { id: name });
				if (e.kind === 'family' && e.parse) this.#prefixes.push([name, e]);
				else this.#single.set(name, e);
			}
			if (!(e.kind === 'family' && e.parse)) this.#by_resolved.set(RESOLVED(key_of(e)), e);
			// the realm module: every entry's names, each once in its realm
			const names = (this.#realms[e.realm] ??= new Map());
			for (const [name, own] of realm_exports(e)) {
				if (names.has(name))
					throw new OgygiaError('virtual_duplicate', { id: `${e.realm}:${name}` });
				names.set(name, [own, key_of(e)]);
			}
		}
		this.constants = constants;
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
		// values first, requests last: a request's real module may import its realm module back,
		// and must then find every value already evaluated
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
	resolve(source: string): string | undefined {
		if (this.#realm_of(source)) return RESOLVED(source);
		const single = this.#single.get(source);
		if (single) {
			if (single.kind === 'family' && !single.load) return undefined;
			return RESOLVED(key_of(single));
		}
		const family = this.#family_of(source);
		if (family) return family.load ? RESOLVED(source) : undefined;
		// (a declared id with a query is the bundler's to answer, as it always was)
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

	/** A resolved id → its module source; `null`: not a module this table loads. */
	load(id: string, app: A, leg: Leg): string | Promise<string> | null {
		const realm = this.#realm_of(id);
		if (realm) return this.#realm_source(realm);
		const e = this.#by_resolved.get(id);
		if (e) {
			if (e.kind === 'value') {
				const data = e.from(app, leg) as Record<string, unknown>;
				return e.exports
					.map((name) => `export const ${name} = ${write_value(data[name])};`)
					.join('\n');
			}
			if (e.kind === 'request') {
				if (!leg.ssr && e.client) return e.client(app);
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
			REALM_IMPORT_G,
			(whole, kw: string, list: string, quote: string, realm: string) => {
				const names = this.#realms[realm as Realm];
				if (!names) return whole;
				const by_module = new Map<string, string[]>();
				for (const part of list.split(',')) {
					const spec = part.trim();
					if (!spec) continue;
					const [name, local = name] = spec.split(/\s+as\s+/);
					const found = names.get(name);
					if (!found) return whole; // the bundler's error: the realm module has no such name
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

	/** Is the module only definitions (a realm module, or an entry it re-exports from)? The bundler
	 *  may then drop it, and what it imports, when none of its names is used. */
	side_effect_free(id: string): boolean {
		if (this.#realm_of(id)) return true;
		const e = this.#by_resolved.get(id);
		return e !== undefined && realm_exports(e).length > 0;
	}

	/** The resolved ids of every module that watches `what`: what a dev change to it invalidates. */
	watching(what: Watch): string[] {
		const out: string[] = [];
		for (const [id, e] of this.#by_resolved) if (e.watch?.includes(what)) out.push(id);
		return out;
	}
}
