import { BARREL_LEFT_REASONS, type BarrelLeftReason } from '@ogygia/core/contract';

/** How many barrels (and unparsable importers) one leg's table holds. */
export const BARREL_LEFT_CAP = 2000;

const QUERY_RE = /[?#].*$/;
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
const clean = (id: string): string => id.replace(QUERY_RE, '');

export interface BarrelLeftTable {
	/** `importer` left an import on `barrel` (null: the importer could not be read at all). */
	record(importer: string, barrel: string | null, reason: BarrelLeftReason): void;
	/** `importer` is transformed again: what it said before no longer holds. */
	forget(importer: string): void;
	/** The reasons `barrel` stayed, in {@link BARREL_LEFT_REASONS} order; `importers` (its importers'
	 *  ids, queries allowed) join an importer that could not be parsed. */
	why(barrel: string, importers: Iterable<string>): BarrelLeftReason[];
	clear(): void;
	/** barrels and unparsable importers held */
	readonly size: number;
}

export function barrel_left_table(cap: number = BARREL_LEFT_CAP): BarrelLeftTable {
	const by_barrel = new Map<string, Map<string, Set<BarrelLeftReason>>>();
	const by_importer = new Map<string, Set<string>>();
	const unparsable = new Set<string>();

	return {
		record(importer, barrel, reason) {
			if (barrel === null) {
				if (by_barrel.size + unparsable.size < cap) unparsable.add(clean(importer));
				return;
			}
			let importers = by_barrel.get(barrel);
			if (importers === undefined) {
				if (by_barrel.size + unparsable.size >= cap) return; // ok: capped, the finding says no reason
				by_barrel.set(barrel, (importers = new Map()));
			}
			let reasons = importers.get(importer);
			if (reasons === undefined) importers.set(importer, (reasons = new Set()));
			reasons.add(reason);
			let barrels = by_importer.get(importer);
			if (barrels === undefined) by_importer.set(importer, (barrels = new Set()));
			barrels.add(barrel);
		},
		forget(importer) {
			unparsable.delete(clean(importer));
			const barrels = by_importer.get(importer);
			if (barrels === undefined) return;
			by_importer.delete(importer);
			for (const barrel of barrels) {
				const importers = by_barrel.get(barrel);
				if (importers === undefined) continue;
				importers.delete(importer);
				if (importers.size === 0) by_barrel.delete(barrel);
			}
		},
		why(barrel, importers) {
			const found = new Set<BarrelLeftReason>();
			for (const reasons of by_barrel.get(clean(barrel))?.values() ?? [])
				for (const r of reasons) found.add(r);
			if (unparsable.size > 0 && !NODE_MODULES_RE.test(barrel))
				for (const i of importers)
					if (unparsable.has(clean(i))) {
						found.add('unparsable');
						break;
					}
			return BARREL_LEFT_REASONS.filter((r) => found.has(r));
		},
		clear() {
			by_barrel.clear();
			by_importer.clear();
			unparsable.clear();
		},
		get size() {
			return by_barrel.size + unparsable.size;
		}
	};
}
