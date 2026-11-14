import { BARREL_LEFT_REASONS, type BarrelLeftReason } from '@ogygia/core/contract';

/** How many barrels (and unparsable importers) one leg's table holds. */
export const BARREL_LEFT_CAP = 2000;

const QUERY_RE = /[?#].*$/;
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
const clean = (id: string): string => id.replace(QUERY_RE, '');

/** Why the pass left an import on its barrel, by barrel and by importer, for one build leg. */
export class BarrelLeftTable {
	readonly #cap: number;
	readonly #by_barrel = new Map<string, Map<string, Set<BarrelLeftReason>>>();
	readonly #by_importer = new Map<string, Set<string>>();
	readonly #unparsable = new Set<string>();

	constructor(cap: number = BARREL_LEFT_CAP) {
		this.#cap = cap;
	}

	/** `importer` left an import on `barrel` (null: the importer could not be read at all). */
	record(importer: string, barrel: string | null, reason: BarrelLeftReason): void {
		if (barrel === null) {
			if (this.size < this.#cap) this.#unparsable.add(clean(importer));
			return;
		}
		let importers = this.#by_barrel.get(barrel);
		if (importers === undefined) {
			if (this.size >= this.#cap) return; // ok: capped, the finding says no reason
			this.#by_barrel.set(barrel, (importers = new Map()));
		}
		let reasons = importers.get(importer);
		if (reasons === undefined) importers.set(importer, (reasons = new Set()));
		reasons.add(reason);
		let barrels = this.#by_importer.get(importer);
		if (barrels === undefined) this.#by_importer.set(importer, (barrels = new Set()));
		barrels.add(barrel);
	}

	/** `importer` is transformed again: what it said before no longer holds. */
	forget(importer: string): void {
		this.#unparsable.delete(clean(importer));
		const barrels = this.#by_importer.get(importer);
		if (barrels === undefined) return;
		this.#by_importer.delete(importer);
		for (const barrel of barrels) {
			const importers = this.#by_barrel.get(barrel);
			if (importers === undefined) continue;
			importers.delete(importer);
			if (importers.size === 0) this.#by_barrel.delete(barrel);
		}
	}

	/** The reasons `barrel` stayed, in {@link BARREL_LEFT_REASONS} order; `importers` (its importers'
	 *  ids, queries allowed) join an importer that could not be parsed. */
	why(barrel: string, importers: Iterable<string>): BarrelLeftReason[] {
		const found = new Set<BarrelLeftReason>();
		for (const reasons of this.#by_barrel.get(clean(barrel))?.values() ?? [])
			for (const r of reasons) found.add(r);
		if (this.#unparsable.size > 0 && !NODE_MODULES_RE.test(barrel))
			for (const i of importers)
				if (this.#unparsable.has(clean(i))) {
					found.add('unparsable');
					break;
				}
		return BARREL_LEFT_REASONS.filter((r) => found.has(r));
	}

	clear(): void {
		this.#by_barrel.clear();
		this.#by_importer.clear();
		this.#unparsable.clear();
	}

	/** barrels and unparsable importers held */
	get size(): number {
		return this.#by_barrel.size + this.#unparsable.size;
	}
}

/** One {@link BarrelLeftTable} per bundler environment (a build leg). */
export class BarrelLeftLegs {
	readonly #legs = new Map<string, BarrelLeftTable>();

	/** The environment's table, made on first use. */
	leg(environment: string): BarrelLeftTable {
		let table = this.#legs.get(environment);
		if (table === undefined) this.#legs.set(environment, (table = new BarrelLeftTable()));
		return table;
	}

	/** The environment begins a build: what its last build said no longer holds. */
	drop(environment: string): void {
		this.#legs.delete(environment);
	}

	/** Why `barrel` stayed in the environment's leg (none: nothing was said there). */
	why(barrel: string, importers: Iterable<string>, environment: string): BarrelLeftReason[] {
		return this.#legs.get(environment)?.why(barrel, importers) ?? [];
	}
}
