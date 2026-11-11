import { machine, type Machine } from '@ogygia/machine';
import { connected_regions } from './connected.ts';

type SheetStates = {
	loading: {};
	loaded: {};
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

/**
 * The download of a region stylesheet (the `<link>` an answer lifted into the head, or one already
 * there with the same href): `loading`, then `loaded` or `failed`. "In the head" is not "loaded", and
 * a link whose download failed never loads, nor fires `load` or `error` again, so it stays `failed`:
 * an answer that finds the sheet waits only on a loading one, and puts a failed one back with a fresh
 * link, which asks for it again (#274).
 */
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
	if (link.sheet !== null) s.go('loaded');
	return s;
}

const used_by = new WeakMap<Element, readonly Element[]>();

/** `region` painted an answer that uses `sheets` (in place of the ones its answer before used). */
export function use_sheets(region: Element, sheets: readonly Element[]): void {
	used_by.set(region, sheets);
}

/**
 * After a navigation's swap: of the region sheets the new page's head does not list (`unlisted`),
 * take out each one no region on the page uses any more. A sheet is for the regions whose answer on
 * screen uses it as well as for the page whose server head lists it, and the server head never lists
 * the sheet of an answer the server did not pick: so a hole kept across the navigation keeps its
 * sheet (#275).
 */
export function release_sheets(unlisted: readonly Element[]): void {
	if (unlisted.length === 0) return;
	const used = new Set<Element>();
	for (const region of connected_regions) {
		const sheets = used_by.get(region);
		if (sheets !== undefined) for (const s of sheets) used.add(s);
	}
	for (const s of unlisted) if (!used.has(s)) s.remove();
}
