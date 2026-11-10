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
		}
		this.constants = constants;
	}

	/**
	 * A specifier → its resolved id. `undefined`: not a table id, or a family whose ids the driver
	 * resolves itself (an island's entry, a registry stub). An id in the namespace that nothing
	 * declares fails here with `virtual_unknown`.
	 */
	resolve(source: string): string | undefined {
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
		const e = this.#by_resolved.get(id);
		if (e) {
			if (e.kind === 'value') return `export default ${write_value(e.from(app, leg))};`;
			if (e.kind === 'request') {
				if (!leg.ssr && e.client) return e.client(app);
				const from = 'core' in e.module ? this.#core_path(app, e.module.core) : e.module.package;
				return `export { ${e.exports.join(', ')} } from ${JSON.stringify(from)};`;
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

	/** The resolved ids of every module that watches `what`: what a dev change to it invalidates. */
	watching(what: Watch): string[] {
		const out: string[] = [];
		for (const [id, e] of this.#by_resolved) if (e.watch?.includes(what)) out.push(id);
		return out;
	}
}
