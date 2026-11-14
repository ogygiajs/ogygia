import { derived, input, Queries, type Query } from './queries.ts';

/** What the scan reads of one file. */
export interface FileFacts {
	/** It crosses Kit's wire: a `.remote` file, or a `region`/`site`/content import. */
	readonly crosses_wire: boolean;
	/** It defines a transportable class (the eager-registration manifest lists it). */
	readonly transportable: boolean;
	/** Its import specifiers (the router CSS closure walks them). */
	readonly specs: readonly string[];
	/** It renders pages outside Kit's routes (`b.pageModules()`): a router CSS root. */
	readonly router: boolean;
}

const ALL = 'all';
const all = () => ALL;
const own = (k: string) => k;

/**
 * THE SCAN'S FACTS, as queries (./queries.ts). Each scanned file has its facts (what the prescan
 * reads of it: does it cross Kit's wire, define a transportable class, render router pages); the
 * app-wide answers the virtual modules bake (the transportable modules, whether anything crosses the
 * wire, the router roots and their import specs) are folds over every scanned file's facts, in scan
 * order. A file's facts are set when the prescan reads it and again when dev transforms it (null
 * when it is deleted); each fold is computed again only when a fact it reads changed, so dev and a
 * cold start give the same answers (test/scan-facts.test.ts).
 */
export class ScanFacts {
	readonly db: Queries = new Queries('scan facts');
	readonly #order: string[] = [];
	readonly #at = new Set<string>();
	/** How many files the scan ever read: the first that many of its scan order. */
	readonly files: Query<string, number> = input('scanned files', all, () => 0);
	readonly facts: Query<string, FileFacts | null> = input('file facts', own, () => null);
	readonly transportable_modules: Query<string, ReadonlySet<string>> = this.#fold(
		'transportable modules',
		(each) => new Set(each.filter(([, f]) => f.transportable).map(([file]) => file))
	);
	readonly wire_crossers: Query<string, ReadonlySet<string>> = this.#fold(
		'wire crossers',
		(each) => new Set(each.filter(([, f]) => f.crosses_wire).map(([file]) => file))
	);
	readonly router_modules: Query<string, ReadonlySet<string>> = this.#fold(
		'router modules',
		(each) => new Set(each.filter(([, f]) => f.router).map(([file]) => file))
	);
	readonly module_specs: Query<string, ReadonlyMap<string, readonly string[]>> = this.#fold(
		'module specs',
		(each) =>
			new Map(each.filter(([, f]) => f.specs.length > 0).map(([file, f]) => [file, f.specs]))
	);

	/** A file's facts, or none (`null`: it is deleted). A new file goes last in scan order. */
	set(full: string, next: FileFacts | null): void {
		const at = this.#at;
		if (next !== null && !at.has(full)) {
			at.add(full);
			this.#order.push(full);
			this.db.set(this.files, ALL, this.#order.length);
		}
		if (at.has(full)) this.db.set(this.facts, full, next);
	}

	/** Whether the scan read this file. */
	has(full: string): boolean {
		return this.db.get(this.facts, full) !== null;
	}

	#fold<V>(name: string, make: (each: Array<[string, FileFacts]>) => V): Query<string, V> {
		const order = this.#order;
		const files = this.files;
		const facts = this.facts;
		return derived(name, all, (cx) => {
			const each: Array<[string, FileFacts]> = [];
			for (const f of order.slice(0, cx.get(files, ALL))) {
				const facts_of = cx.get(facts, f);
				if (facts_of) each.push([f, facts_of]);
			}
			return make(each);
		});
	}
}
