import { entry_location, region_deps } from '#region-server';
import { kit_asset } from '../kit-paths.ts';

/** Where a region module's chunk is served, or `''` when the build knows no chunk for it. */
export function location_of(identity: string): string {
	const found = identity ? entry_location(identity) : null;
	return found ? kit_asset(found) : '';
}

/** The chunks a region module needs before it runs: its own deps, then each live module's chunk and
 *  deps, each once and never the module itself. */
export function graph_hrefs(
	entry: string,
	self_url: string,
	live_entries: readonly string[] | null | undefined
): string[] {
	const deps = region_deps(entry);
	if (!live_entries?.length) return deps.map((dep) => kit_asset(dep));
	const seen = new Set([self_url]);
	const hrefs: string[] = [];
	const add = (href: string) => {
		if (href && !seen.has(href)) {
			seen.add(href);
			hrefs.push(href);
		}
	};
	for (const dep of deps) add(kit_asset(dep));
	for (const m of live_entries) {
		add(location_of(m));
		for (const dep of region_deps(m)) add(kit_asset(dep));
	}
	return hrefs;
}
