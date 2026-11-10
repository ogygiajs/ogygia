/**
 * The content graph registry. Every `Collection` registers here so relations resolve across
 * collections and backlinks invert: build/server-side metadata, not per-request state. It is one
 * global, shared by every copy of this package a process loads (the app's, and the dev plugin's).
 */
import type { Collection } from './collection-base.ts';
import { slot } from '@ogygia/machine';

/** Which run of which module built a collection (dev only). */
export type ModuleRun = {
	/** The id of the module whose code calls `content()`. */
	module: string;
	/** Its run: higher for each run of a module, the newest run highest. */
	run: number;
};

export type ContentGraph = {
	all: Set<Collection<Record<string, unknown>>>;
	/** The module run whose `content()` call is building a collection right now (dev only). */
	building?: ModuleRun;
	/**
	 * Dev only. The content dev plugin's transform calls it at the top of each server module that
	 * calls `content()`, with the module's id, once per run of the module, and passes each of the
	 * module's `content()` calls through what it returns: the call builds in that run. A collection
	 * a newer run of its module builds replaces the ones older runs built (#247).
	 */
	module_run?: (module: string) => <F extends (...args: never[]) => unknown>(build: F) => F;
};

export const GRAPH: ContentGraph = slot<ContentGraph>({
	name: 'ogygia.content.graph',
	version: 1,
	make: () => ({ all: new Set() })
});

let runs = 0;
GRAPH.module_run ??= (module) => {
	const run: ModuleRun = { module, run: ++runs };
	return (build) =>
		((...args) => {
			const outer = GRAPH.building;
			GRAPH.building = run;
			try {
				return build(...args);
			} finally {
				GRAPH.building = outer;
			}
		}) as typeof build;
};
