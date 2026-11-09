/**
 * The content graph registry. Every `Collection` registers here so relations resolve across
 * collections and backlinks invert: build/server-side metadata, not per-request state. It is one
 * global, shared by every copy of this package a process loads (the app's, and the dev plugin's).
 * In dev, a collection leaves it when the run of the module that built it ends (collection-base.ts,
 * through core's definer marking).
 */
import type { Collection } from './collection-base.ts';

export type ContentGraph = {
	all: Set<Collection<Record<string, unknown>>>;
};

export const GRAPH: ContentGraph = ((globalThis as Record<symbol, unknown>)[
	Symbol.for('ogygia.content.graph')
] ??= { all: new Set() }) as ContentGraph;
