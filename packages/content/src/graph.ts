/**
 * The content graph registry. Every `Collection` registers here so relations resolve across
 * collections and backlinks invert: build/server-side metadata, not per-request state. It is one
 * global, shared by every copy of this package a process loads (the app's, and the dev plugin's).
 * In dev, a collection leaves it when the run of the module that built it ends (collection-base.ts,
 * through core's definer marking).
 */
import { registry, slot, type Registry } from '@ogygia/machine';
import type { Collection } from './collection-base.ts';

export type ContentGraph = {
	/** The collections in the graph: each held while it is not disposed (its own scope, see
	 *  collection-base.ts), never evicted. */
	all: Registry<Collection<Record<string, unknown>>>;
};

// (version 2: `all` is a registry; version 1 held a Set and the module runs)
export const GRAPH: ContentGraph = slot<ContentGraph>({
	name: 'ogygia.content.graph',
	version: 2,
	make: () => ({ all: registry() })
});
