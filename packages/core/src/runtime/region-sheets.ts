import { machine, type Machine } from '@ogygia/machine';
import { connected_regions } from './connected.ts';
import { head_owners } from '../head-owners.ts';
import { OG_FP, OG_OWNER, OGYGIA_REGION_CSS } from '../wire-markup.ts';
import { runtime_session } from './session.ts';

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

const brought_by = new WeakMap<object, readonly Element[]>();
const code_sheets = new WeakSet<Element>();
const code_used_by = new WeakMap<Element, readonly Element[]>();
const STYLESHEET_REL_RE = /(?:^|\s)stylesheet(?:\s|$)/i;

/**
 * Note the stylesheets `loading` (the load of the island file at `url`) puts in the head: each new
 * link under the file's own folder (the build's, where its CSS assets live) that no one else owns
 * becomes a page-owned region sheet, for the regions that run the module it resolves to. A bundler's
 * preloader adds the CSS a file's chunks need as the file runs, and nothing else marks it (#966):
 * these code sheets follow the rule of an answer's sheets, in while one region that runs the file is
 * on the page, out after a navigation that leaves none.
 */
export function note_code_sheets<T>(url: string, loading: Promise<T>): Promise<T> {
	if (typeof document === 'undefined') return loading;
	const before = new Set<Element>(document.head.children);
	return loading.then((module) => {
		let dir: string;
		try {
			dir = new URL('.', new URL(url, document.baseURI)).href;
			// oxlint-disable-next-line ogygia/no-silent-failures -- not a URL, so no folder of its own to own sheets in
		} catch {
			return module;
		}
		const sheets: Element[] = [];
		const session = runtime_session;
		for (const n of document.head.children) {
			if (before.has(n) || n.localName !== 'link') continue;
			if (!code_sheets.has(n)) {
				if (!STYLESHEET_REL_RE.test(n.getAttribute('rel') ?? '')) continue;
				if (session.page_head.has(n) || session.island_head.has(n)) continue;
				if (!(n as HTMLLinkElement).href.startsWith(dir)) continue;
				n.setAttribute(OGYGIA_REGION_CSS, '');
				session.claim_page_head(n);
				code_sheets.add(n);
			}
			sheets.push(n);
		}
		if (sheets.length > 0 && typeof module === 'object' && module !== null)
			brought_by.set(module, sheets);
		return module;
	});
}

/**
 * `region` runs `module`: it uses the sheets the module's load brought, and a navigation that took
 * them out (the module stays loaded, so its preloader never adds them again) puts them back, as a
 * fresh load of this page has them.
 */
export function use_code_sheets(region: Element, module: object): void {
	const sheets = brought_by.get(module);
	if (sheets === undefined) return;
	code_used_by.set(region, sheets);
	for (const s of sheets) if (!s.isConnected) document.head.appendChild(s);
}

/**
 * After a navigation's swap: of the region head nodes the new page's head does not list
 * (`unlisted`: region sheets, and every tag that names an owning region), take out each one no
 * region on the page uses or owns any more. A tag names its owners (`data-og-owner`, the outermost
 * islands' fingerprints, space-separated) because the server skips a region the browser already
 * has, and the tags its inner regions wrote with it (#806). A sheet several outer islands share
 * names them all (#854, head-owners.ts). "On the page" is read from the document: a region the
 * swap took out leaves `connected_regions` only at its teardown, a microtask later, and uses no
 * sheet from the moment it left (#799, test/browser/nav-region-sheet-left.test.ts).
 *
 * Every owner list is cut to the owners still on the page (kept to its first when none is): one
 * that left can come back only rendered again, and its tags name it again then.
 */
export function release_head_nodes(unlisted: readonly Element[]): void {
	const shared = document.head.querySelectorAll(`[${OG_OWNER}*=" "]`);
	if (unlisted.length === 0 && shared.length === 0) return;
	const used = new Set<Element>();
	const owners = new Set<string>();
	for (const region of connected_regions) {
		if (!region.isConnected) continue;
		const sheets = used_by.get(region);
		if (sheets !== undefined) for (const s of sheets) used.add(s);
		const code = code_used_by.get(region);
		if (code !== undefined) for (const s of code) used.add(s);
		const fp = region.getAttribute(OG_FP);
		if (fp) owners.add(fp);
	}
	for (const node of unlisted) {
		if (used.has(node)) continue;
		if (head_owners(node).some((o) => owners.has(o))) continue;
		node.remove();
	}
	for (const node of Array.from(shared)) {
		if (!node.isConnected) continue;
		const list = head_owners(node);
		const on_page = list.filter((o) => owners.has(o));
		node.setAttribute(OG_OWNER, (on_page.length ? on_page : list.slice(0, 1)).join(' '));
	}
}
