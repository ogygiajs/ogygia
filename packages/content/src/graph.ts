/**
 * The content graph registry. Every `Collection` registers here so relations resolve across
 * collections and backlinks invert: build/server-side metadata, not per-request state. It is one
 * global, shared by every copy of this package a process loads (the app's, and the dev plugin's).
 */
import type { Collection } from './collection-base.ts';

/** Which run of which module built a collection (dev only). */
export type ModuleRun = {
	/** The module whose code called `content()`. */
	module: string;
	/** Its run: the same for every collection one run of the module builds, and for no other run. */
	run: string;
};

export type ContentGraph = {
	all: Set<Collection<Record<string, unknown>>>;
	/**
	 * Dev only, set by the content dev plugin: the module run calling `caller` now, or null when it
	 * is no module the dev server runs. A collection a newer run of its module builds replaces the
	 * ones its older runs built (#247).
	 */
	module_run?: (caller: (...args: never[]) => unknown) => ModuleRun | null;
};

export const GRAPH: ContentGraph = ((globalThis as Record<symbol, unknown>)[
	Symbol.for('ogygia.content.graph')
] ??= { all: new Set() }) as ContentGraph;
