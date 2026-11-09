/**
 * A REGION STYLESHEET'S DOWNLOAD, as a machine: the `<link>` an answer lifted into the head, or one
 * already there with the same href.
 *
 *   loading ─ loaded
 *          ╲ failed
 *
 * "In the head" is not "loaded", and a link whose download failed never loads, nor fires `load` or
 * `error` again. So an answer that finds the sheet waits only on a loading one, and puts a failed
 * one back with a fresh link, which asks for it again (#274).
 */
import { machine, type Machine } from '@ogygia/machine';

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
