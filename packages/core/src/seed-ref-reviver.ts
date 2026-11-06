/**
 * The CLIENT half of seed references (seed-refs.ts): the devalue type tag and the reviver that
 * resolves a reference against the page seed. Its own module because the hydrate core is a lazy
 * runtime chunk that shares modules with Kit's client graph (route components compiled for the
 * browser, never loaded on a csr=false page). The bundler keeps a shared module whole — every
 * export ANY importer uses — so while the reviver lived beside the server-side index and planner,
 * every island page downloaded the planner (~4 kB) for the Kit graph's sake. A leaf holds only
 * what the hydrate core runs.
 */
import { warn } from './messages/lazy.ts';

/** The devalue type tag. */
export const SEED_REF_KEY = 'OgygiaSeedRef';

export type SeedPath = (string | number)[];

/** Client: the node a path points at, or `undefined` when the seed does not have it. */
export function resolve_seed_ref(data: unknown, path: SeedPath): unknown {
	let cur: unknown = data;
	for (const key of path) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string | number, unknown>)[key];
	}
	return cur;
}

/**
 * Client reviver for the devalue type: resolve BY REFERENCE. The island receives the seed's own
 * node — the same object its `page.data` read would hand it, shared exactly the way `page.data`
 * already is between islands. A deep copy per reference (129 of them on a measured page) bought
 * nothing: island props are a snapshot either way, and the DEV mutation guard the runtime wraps
 * every island's props in (`PropMutationGuard`) already warns on a write into them. `get_data` is
 * called lazily, once per reviver — the first reference resolves the seed. A dangling path (no seed,
 * or a seed that does not carry the node) revives to `undefined` and, in dev, says why.
 */
export function seed_ref_reviver(get_data: () => unknown): (path: SeedPath) => unknown {
	let data: unknown;
	let resolved = false;
	return (path) => {
		if (!resolved) {
			data = get_data();
			resolved = true;
		}
		const node = resolve_seed_ref(data, path);
		if (node === undefined && typeof console !== 'undefined' && import.meta.env?.DEV) {
			warn('page_seed_ref_missing', { path: JSON.stringify(path) });
		}
		return node;
	};
}
