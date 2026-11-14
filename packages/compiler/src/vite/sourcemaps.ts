import path from 'node:path';
import type { Plugin } from 'vite';
import { strip_id, type Program } from '../program.ts';
import { is_generated_specifier } from '../virtual/table.ts';

/**
 * Rewrite vite-plugin-svelte island sourcemap `sources` so Vite treats them as virtual.
 *
 * Svelte emits the basename of `ogygia:region/entry/<id>.svelte` (just `<id>.svelte`).
 * That string does not match Vite's `virtualSourceRE`, so `injectSourcesContent` tries a
 * disk read and warns "points to missing source files". Pointing sources back at the
 * full virtual module id silences the warning (and keeps maps coherent).
 *
 * @internal Also covered by unit tests.
 */
export function rewrite_island_sourcemap_sources(
	moduleId: string,
	sources: (string | null)[] | undefined
): (string | null)[] | null {
	if (!sources?.length) return null;
	let changed = false;
	const next = sources.map((s) => {
		if (typeof s !== 'string') return s;
		if (s === moduleId || is_generated_specifier(s) || s.includes('\0')) return s;
		if (s.endsWith('.svelte') && !s.includes('/') && !path.isAbsolute(s)) {
			changed = true;
			return moduleId;
		}
		return s;
	});
	return changed ? next : null;
}

/** The `ogygia:island-sourcemaps` post plugin (Vite flattens it into the adapter's array). */
export function island_sourcemaps_plugin(deps: {
	/** The build under way's program. */
	program: () => Program;
	is_island_path: (id: string) => boolean;
}): Plugin {
	const { program, is_island_path } = deps;
	return {
		name: 'ogygia:island-sourcemaps',
		enforce: 'post',
		transform(code, id) {
			const bare = strip_id(id);
			if (!is_island_path(bare)) return null;
			if (bare.includes('/wrapper/')) return { code, map: { mappings: '' } };
			let map: {
				version: number;
				mappings: string;
				names: string[];
				sources: (string | null)[];
				sourcesContent?: (string | null)[];
				file?: string;
			};
			try {
				map = this.getCombinedSourcemap();
				// oxlint-disable-next-line ogygia/no-silent-failures -- no combined map to touch up: the module keeps the map it has (a dev polish pass)
			} catch {
				return null;
			}
			if (!map?.mappings || !map.sources?.length) return null;
			const rewritten = rewrite_island_sourcemap_sources(bare, map.sources);
			const sources = rewritten ?? map.sources;
			const entry = program().registry.get(bare);
			const base_name = bare.slice(bare.lastIndexOf('/') + 1);
			let injected = false;
			const sourcesContent = sources.map((s, i) => {
				const prev = Array.isArray(map.sourcesContent)
					? (map.sourcesContent as (string | null)[])[i]
					: null;
				if (prev != null) return prev;
				if (entry && (s === bare || s === base_name)) {
					injected = true;
					return entry.source;
				}
				return null;
			});
			if (!rewritten && !injected) return null;
			return {
				code,
				map: { ...map, sources, sourcesContent }
			};
		}
	};
}
