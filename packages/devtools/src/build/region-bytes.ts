/**
 * Dev-only per-island byte estimate — walks DOWN the Vite dev module graph from each island entry
 * and sums the served (transformed) size of the APP modules it transitively imports: its wrapper,
 * the component, and every child component / app util the component pulls in. Not just the wrapper
 * chunk a `PerformanceResourceTiming` lookup sees — but also NOT the shared framework.
 *
 * The framework boundary is pruned (`node_modules`, Vite's `.vite/deps` prebundles): Svelte's runtime
 * is loaded ONCE for the whole page, so folding it into every island makes them all read as ~2 MB and
 * hides the real difference. Counting only app code surfaces the number that actually varies island to
 * island — "what does THIS component cost on top of the shared runtime".
 *
 * Caveats (surfaced in the tab): dev code is unbundled + unminified, so the number is an ESTIMATE of
 * relative cost, not the shipped byte count; and a still-cold island (one that hasn't woken, so its
 * component was never loaded) has no subgraph in the graph yet — it simply doesn't appear here until
 * it wakes. Pure over the nodes it's handed; reads, never mutates.
 */
import {
	hydration_hazards,
	type BarrelLeftReason,
	type IslandBarrel,
	type IslandHazard
} from '@ogygia/core/insights';
import { region_family } from '@ogygia/core/internal/compiler-ids';
import { OGYGIA_SCHEME, OWN_FILE_RE } from '@ogygia/core/internal/compiler';

/** Structural shape of a Vite dev module-graph node (the fields the byte walk reads). */
export type ByteGraphModule = {
	url?: string | null;
	id?: string | null;
	file?: string | null;
	transformResult?: { code?: string | null } | null;
	importedModules?: Iterable<ByteGraphModule>;
	importers?: Iterable<ByteGraphModule>;
};

/** Why the barrel pass left a barrel (its file on disk; its importers' ids): its reasons, if any. */
export type BarrelWhy = (file: string, importers: Iterable<string>) => BarrelLeftReason[];

/** A region entry module — `ogygia:region/entry/<id>.js` (dev url carries the id). */
const ISLAND_RE = /ogygia:region\/entry\/([0-9a-f]+)\.js/;
const ENTRY_PREFIX = region_family('entry');

/** Shared framework / prebundled deps — pruned so per-island totals reflect app code, not Svelte. */
function is_framework(mod: ByteGraphModule): boolean {
	const s = (mod.file || '') + '\n' + (mod.url || mod.id || '');
	const u = mod.url || mod.id || '';
	return (
		s.includes('node_modules') ||
		s.includes('/.vite/deps/') ||
		// the ogygia package runtime — its modules resolve to `packages/core/src` in dev and
		// `.../@ogygia/core/dist` in prod; both are shared once per page, not part of an island's cost.
		OWN_FILE_RE.test(s) ||
		// SHARED ogygia registries — `ogygia:region/transportables` (every wire/store class app-wide),
		// `…/transport`, `ogygia:boot/fn-manifest`, the manifests. One island importing the transportable
		// registry would otherwise drag in EVERY transportable-defining module (the whole app). These
		// load once per page. The region's own entry (`ogygia:region/entry/…`) is the ONE exception —
		// it's the door to the component, so it stays traversable (see `is_glue`).
		(u.includes(OGYGIA_SCHEME) && !u.includes(ENTRY_PREFIX))
	);
}

/**
 * The region's own entry glue (`ogygia:region/entry/<id>.js`, its wrapper). Traversed THROUGH to
 * reach the real component, but not COUNTED — it's the region's door, not the component's weight.
 */
function is_glue(mod: ByteGraphModule): boolean {
	return (mod.url || mod.id || '').includes(ENTRY_PREFIX);
}

/**
 * `island id → { bytes, modules }` for every island entry present in the graph, where `bytes` is the
 * summed served size of the entry's whole transitive import subgraph and `modules` the node count.
 * When two graph nodes resolve to the same island id (e.g. `?v=` query variants), the larger wins.
 */
export function island_subgraph_bytes(
	modules: Iterable<ByteGraphModule>,
	/** an app `.svelte` file's source, by its path on disk: what draws differently in the browser */
	read?: (file: string) => string | undefined,
	why?: BarrelWhy
): Record<string, IslandBytes> {
	const out: Record<string, IslandBytes> = {};
	for (const mod of modules) {
		const url = mod.url || mod.id || '';
		const m = ISLAND_RE.exec(url);
		if (!m) continue;
		const iid = m[1];
		const seen = new Set<ByteGraphModule>();
		const stack: ByteGraphModule[] = [mod];
		let bytes = 0;
		let count = 0;
		let steps = 0;
		const each: { file: string; bytes: number }[] = [];
		const barrels: IslandBarrel[] = [];
		const hazards: IslandHazard[] = [];
		while (stack.length && steps++ < 20000) {
			const n = stack.pop()!;
			if (seen.has(n)) continue;
			seen.add(n);
			// Prune at the framework boundary — don't count Svelte/ogygia runtime/registries, and don't
			// descend into their large subgraphs (keeps the number app-focused and the walk cheap).
			if (is_framework(n)) {
				// (the site kit's components — ogygia's content/site, an app's own islands in all but
				// location — are no app bytes, but their lines can draw differently in the browser)
				const f = (n.file || '').split('\\').join('/');
				const at = f.indexOf('/content/');
				if (
					read &&
					at !== -1 &&
					OWN_FILE_RE.test(f) &&
					f.endsWith('.svelte') &&
					hazards.length < 5
				) {
					const src = read(n.file!);
					if (src)
						for (const h of hydration_hazards(src).slice(0, 3))
							if (hazards.length < 5) hazards.push({ file: `ogygia/${f.slice(at + 1)}`, ...h });
				}
				continue;
			}
			// Traverse into everything else (incl. the island's own entry glue) to reach the component...
			let fanout = 0;
			for (const dep of n.importedModules ?? []) {
				stack.push(dep);
				if (!is_framework(dep)) fanout++;
			}
			// ...but count only the app modules — the component + its child components / utils.
			if (is_glue(n)) continue;
			const code = n.transformResult?.code;
			if (typeof code === 'string') {
				bytes += code.length;
				count++;
				const file = short_url(n);
				each.push({ file, bytes: code.length });
				// a BARREL the island still imports whole: little code of its own, many app modules
				// behind it (a pure re-export index). Every module behind it rides into the island.
				// (a component uses what it imports: only a script module can be a re-export index)
				if (
					fanout >= BARREL_FANOUT &&
					code.length <= fanout * BARREL_BYTES_PER_EXPORT &&
					!file.endsWith('.svelte')
				) {
					const reasons =
						why && n.file
							? why(
									n.file,
									[...(n.importers ?? [])].map((m) => m.id || m.file || '')
								)
							: [];
					barrels.push(reasons.length ? { file, fanout, why: reasons } : { file, fanout });
				}
				// its lines that draw differently in the browser (its source on disk, not the served code)
				if (read && n.file && file.endsWith('.svelte') && hazards.length < 5) {
					const src = read(n.file);
					if (src)
						for (const h of hydration_hazards(src).slice(0, 3))
							if (hazards.length < 5) hazards.push({ file, ...h });
				}
			}
		}
		// (a site-kit island has no app bytes of its own, and still its lines)
		if ((count > 0 || hazards.length) && (!out[iid] || out[iid].bytes < bytes)) {
			each.sort((a, b) => b.bytes - a.bytes);
			out[iid] = {
				bytes,
				modules: count,
				top: each.slice(0, 5),
				...(barrels.length
					? { barrels: barrels.sort((a, b) => b.fanout - a.fanout).slice(0, 3) }
					: {}),
				...(hazards.length ? { hazards } : {})
			};
		}
	}
	return out;
}

/** An island's app code in dev: the total, its heaviest modules, and any barrel it pulls whole. */
export interface IslandBytes {
	bytes: number;
	modules: number;
	/** the heaviest modules (served size, heaviest first): what to look at first */
	top?: { file: string; bytes: number }[];
	/** re-export barrels still in the island's graph, with how many app modules each drags in */
	barrels?: IslandBarrel[];
	/** its components' lines that draw differently in the browser (a top-level await, a browser-only value) */
	hazards?: IslandHazard[];
}

/** a barrel re-exports at least this many app modules… */
const BARREL_FANOUT = 6;
/** …with about this much code of its own per module (an `export … from` line, transformed) */
const BARREL_BYTES_PER_EXPORT = 160;

/** A module's served path, query dropped; a file outside the root (`/@fs/…`) by its last parts. */
function short_url(n: ByteGraphModule): string {
	const u = (n.url || n.id || '').split('?')[0];
	if (u.startsWith('/@fs/')) return u.split('/').slice(-3).join('/');
	return u.startsWith('/') ? u.slice(1) : u;
}
