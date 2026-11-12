/**
 * REGION STYLESHEETS: the `<link>` (or inlined `<style>`) an answer lifted into the head, or one
 * already there with the same href.
 *
 * Its download, as a machine:
 *
 *   loading ─ loaded
 *          ╲ failed
 *
 * "In the head" is not "loaded", and a link whose download failed never loads, nor fires `load` or
 * `error` again. So an answer that finds the sheet waits only on a loading one, and puts a failed
 * one back with a fresh link, which asks for it again (#274).
 *
 * Who it is for: the regions whose answer on screen uses it, as well as the page whose server head
 * lists it. The server head never lists the sheet of an answer the server did not pick, so a
 * navigation takes a region sheet out only once the new page neither lists it nor has a region that
 * uses it: a hole kept across the navigation keeps its sheet (#275).
 */
import { machine, type Machine } from '@ogygia/machine';
import { connected_regions } from './connected.ts';
import { OG_FP, OG_OWNER } from '../wire-markup.ts';

type SheetStates = {
	/** Its download is in flight. */
	loading: {};
	/** In, and styling the page. */
	loaded: {};
	/** Its download failed. It stays failed: a fresh link asks again. */
	failed: {};
};

const sheet_steps = {
	loading: ['loaded', 'failed'],
	loaded: [],
	failed: []
} as const;

const sheet_definition = machine<SheetStates>()({
	name: 'region-sheet',
	initial: 'loading',
	steps: sheet_steps
});

export type RegionSheet = Machine<SheetStates, typeof sheet_steps>;

const sheets = new WeakMap<HTMLLinkElement, RegionSheet>();

/**
 * The download of a stylesheet link, watched from the first time an answer looks at it. A link made
 * here is watched before it goes into the head, so it never misses its `load` or `error`. One that was
 * there first (the server's) counts as loaded once it has a `sheet`; one with no `sheet` yet is still
 * loading. (Chromium gives a failed link an empty sheet, so a server link that failed before anyone
 * looked counts as loaded: the page's own sheets are the page's.)
 */
export function sheet_of(link: HTMLLinkElement): RegionSheet {
	const known = sheets.get(link);
	if (known !== undefined) return known;
	const s = sheet_definition.create();
	sheets.set(link, s);
	s.scope.on(link, 'load', () => s.go('loaded'));
	s.scope.on(link, 'error', () => s.go('failed'));
	// attach, then check: `sheet` is set with the load event, so one that loaded before the listeners
	// were on is seen here
	if (link.sheet !== null) s.go('loaded');
	return s;
}

/** The sheets in the head each region's answer on screen uses, by region. */
const used_by = new WeakMap<Element, readonly Element[]>();

/** `region` painted an answer that uses `sheets` (in place of the ones its answer before used). */
export function use_sheets(region: Element, sheets: readonly Element[]): void {
	used_by.set(region, sheets);
}

/**
 * After a navigation's swap: of the region head nodes the new page's head does not list
 * (`unlisted`: region sheets, and every tag that names an owning region), take out each one no
 * region on the page uses or owns any more. A tag names its owner (`data-og-owner`, the outermost
 * island's fingerprint) because the server skips a region the browser already has, and the tags
 * its inner regions wrote with it (#806). "On the page" is read from the document: a region the
 * swap took out leaves `connected_regions` only at its teardown, a microtask later, and uses no
 * sheet from the moment it left (#799, test/browser/nav-region-sheet-left.test.ts).
 */
export function release_head_nodes(unlisted: readonly Element[]): void {
	if (unlisted.length === 0) return;
	const used = new Set<Element>();
	const owners = new Set<string>();
	for (const region of connected_regions) {
		if (!region.isConnected) continue;
		const sheets = used_by.get(region);
		if (sheets !== undefined) for (const s of sheets) used.add(s);
		const fp = region.getAttribute(OG_FP);
		if (fp) owners.add(fp);
	}
	for (const node of unlisted) {
		if (used.has(node)) continue;
		const owner = node.getAttribute(OG_OWNER);
		if (owner !== null && owners.has(owner)) continue;
		node.remove();
	}
}
