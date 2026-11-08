/**
 * The islands' component names for the dock and the testing API: a build carries them in
 * `virtual:ogygia/devtools-meta`; the dev server serves them live (`/__ogygia_devtools_meta`, the
 * registry as it is now). Both land on `window.__ogygia_region_names`, which regions.ts reads.
 * Once per page; best effort (a hash stands in for a name it cannot find). A fetch that failed (the
 * network, not an answer) is not kept: the next ask fetches again.
 */
import { flights } from '@ogygia/machine';
import { names as built_names } from 'virtual:ogygia/devtools-meta';

const loading = flights({
	name: 'devtools region names',
	run: async () => {
		if (typeof window === 'undefined') return;
		if (built_names && Object.keys(built_names).length) {
			window.__ogygia_region_names = { ...built_names, ...window.__ogygia_region_names };
			return;
		}
		const r = await fetch('/__ogygia_devtools_meta');
		// no meta endpoint (a build with no names): hashes stand in
		if (!r.ok) return;
		const meta = (await r.json().catch(() => null)) as {
			names?: Record<string, string>;
			bytes?: Record<string, unknown>;
		} | null;
		if (meta?.names)
			window.__ogygia_region_names = { ...meta.names, ...window.__ogygia_region_names };
		if (meta?.bytes)
			(window as unknown as { __ogygia_region_bytes?: unknown }).__ogygia_region_bytes = meta.bytes;
	}
});

export function ensure_region_names(): Promise<void> {
	// (a failed fetch: hashes stand in this time, and the next ask fetches again)
	return loading.get().then(
		() => {},
		() => {}
	);
}
