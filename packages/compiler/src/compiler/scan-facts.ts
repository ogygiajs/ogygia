/**
 * THE SCAN'S FACTS, as queries (./queries.ts). Each scanned file has its facts (what the prescan
 * reads of it: does it cross Kit's wire, define a transportable class, render router pages, call a
 * flag); the app-wide answers the virtual modules bake (the transportable modules, whether anything
 * crosses the wire, the router roots and their import specs, the flag sites) are folds over every
 * scanned file's facts, in scan order. A file's facts are set when the prescan reads it and again
 * when dev transforms it (null when it is deleted); each fold is computed again only when a fact it
 * reads changed, so dev and a cold start give the same answers (test/scan-facts.test.ts).
 */
import type { FlagSite } from './flags.ts';
import { derived, input, queries, type Queries, type Query } from './queries.ts';

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
	/** Its `flag()` calls. */
	readonly flag_sites: readonly FlagSite[];
}

const ALL = 'all';
const all = () => ALL;
const own = (k: string) => k;

export interface ScanFacts {
	readonly db: Queries;
	/** How many files the scan ever read: the first that many of its scan order. */
	readonly files: Query<string, number>;
	readonly facts: Query<string, FileFacts | null>;
	readonly transportable_modules: Query<string, ReadonlySet<string>>;
	readonly wire_crossers: Query<string, ReadonlySet<string>>;
	readonly router_modules: Query<string, ReadonlySet<string>>;
	readonly module_specs: Query<string, ReadonlyMap<string, readonly string[]>>;
	readonly flag_sites: Query<string, readonly FlagSite[]>;
	/** A file's facts, or none (`null`: it is deleted). A new file goes last in scan order. */
	set(full: string, facts: FileFacts | null): void;
	/** Whether the scan read this file. */
	has(full: string): boolean;
}

export function scan_facts(): ScanFacts {
	const db = queries('scan facts');
	/** Every file the scan ever read, in the order it first read them. It only grows, so its first
	 *  `files` entries are a value: the `files` input stands for them (a deleted file's facts are
	 *  null). One more file is one more revision, not a copy of the list. */
	const order: string[] = [];
	const at = new Set<string>();
	// (set, never read from outside: the scan hands each file's facts in)
	const files = input<string, number>('scanned files', all, () => 0);
	const facts = input<string, FileFacts | null>('file facts', own, () => null);

	/** A fold over one fact of every file, in scan order. */
	const fold = <V>(name: string, make: (each: Array<[string, FileFacts]>) => V): Query<string, V> =>
		derived(name, all, (cx) => {
			const each: Array<[string, FileFacts]> = [];
			for (const f of order.slice(0, cx.get(files, ALL))) {
				const facts_of = cx.get(facts, f);
				if (facts_of) each.push([f, facts_of]);
			}
			return make(each);
		});
	return {
		db,
		files,
		facts,
		transportable_modules: fold(
			'transportable modules',
			(each) => new Set(each.filter(([, f]) => f.transportable).map(([file]) => file))
		),
		wire_crossers: fold(
			'wire crossers',
			(each) => new Set(each.filter(([, f]) => f.crosses_wire).map(([file]) => file))
		),
		router_modules: fold(
			'router modules',
			(each) => new Set(each.filter(([, f]) => f.router).map(([file]) => file))
		),
		module_specs: fold(
			'module specs',
			(each) =>
				new Map(each.filter(([, f]) => f.specs.length > 0).map(([file, f]) => [file, f.specs]))
		),
		flag_sites: fold('flag sites', (each) => each.flatMap(([, f]) => f.flag_sites)),
		set(full, next) {
			if (next !== null && !at.has(full)) {
				at.add(full);
				order.push(full);
				db.set(files, ALL, order.length);
			}
			if (at.has(full)) db.set(facts, full, next);
		},
		has(full) {
			return db.get(facts, full) !== null;
		}
	};
}
