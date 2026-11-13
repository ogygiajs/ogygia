/**
 * CONTINUITY — ambient island form-field survival across SPA navigation.
 *
 * Leaving a page, every island input whose value differs from its SSR default is snapshotted into a
 * tab-session store, keyed by the page's path + the island's name (its component and endpoint, and
 * which copy of that island it is: never its place among the page's regions, which shifts when an
 * island comes or goes, #1337) + the field's child-index path (the same addressing `interaction`
 * uses, because hydration can replace nodes). Returning to that
 * page, each field is restored when its island (re)hydrates, with `input`/`change` fired so `bind:`
 * syncs. Session-scoped: survives navigation and back/forward, dies with the tab, never persisted.
 *
 * Only DIFFS are stored (default → nothing), bounded page count, so this stays cheap.
 */
import { cache, machine } from '@ogygia/machine';
import { element_address, resolve_address } from './interaction.ts';
// (not reconcile.ts's `region_signature` nor ./hash.ts: both stay out of the boot)
import { signature_of } from '../contract/signature.ts';
import { slots } from './slots.ts';
import { OGYGIA_NO_KEEP } from '../wire-markup.ts';

/** Feature entry: enable form-field survival across SPA nav (unless the build disabled it). */
export function install(): void {
	const on =
		typeof __OGYGIA_CONTINUITY_FORMS__ !== 'undefined' ? __OGYGIA_CONTINUITY_FORMS__ : true;
	if (!on) return;
	slots.forms = { enabled: true, snapshot: snapshot_forms, restore: arm_form_restore };
}

const VALUE_SELECTOR = 'input, textarea, select';
const MAX_PAGES = 20;

type FieldRec = {
	/** The island's name on its page (`region_names`). */
	region: string;
	addr: number[];
	tag: string;
	value: string;
	checked: boolean | undefined;
};

/** pathKey → the fields a visitor changed on that page (in this tab session). */
const store = cache<string, FieldRec[]>({ name: 'form continuity', max: MAX_PAGES });

/** How long a page's restore listens for its islands' hydrations (they have all hydrated by
 *  then, or never will). */
const RESTORE_WINDOW_MS = 5000;

/**
 * THE RESTORE WINDOW, one per page visit: `open` while a page's saved fields wait for its islands
 * to hydrate. It closes on its own after RESTORE_WINDOW_MS, when the page is left (the next
 * navigation's snapshot), or when another page's restore opens; leaving `open` removes its
 * listeners, so a page's values never reach the next page's islands.
 */
const restore_window = machine<{ idle: {}; open: {} }>()({
	name: 'form-restore',
	initial: 'idle',
	steps: { idle: ['open'], open: ['idle'] },
	after: { open: { ms: RESTORE_WINDOW_MS, to: 'idle' } }
}).create();

/** The page being left (or another page's restore opening) ends the open window. */
function close_restore(): void {
	if (restore_window.now.kind === 'open') restore_window.go('idle');
}

const is_checkable = (f: HTMLInputElement) => f.type === 'checkbox' || f.type === 'radio';

/** Each region's name on its page: its signature (component and endpoint) and which copy of that
 *  island it is, in document order. */
function region_names(regions: Iterable<Element>): Map<Element, string> {
	const copies = new Map<string, number>();
	const names = new Map<Element, string>();
	for (const region of regions) {
		const signature = signature_of(
			region.getAttribute('entry') ?? '',
			region.getAttribute('endpoint') ?? ''
		);
		const n = copies.get(signature) ?? 0;
		copies.set(signature, n + 1);
		names.set(region, `${n} ${signature}`);
	}
	return names;
}

/** Snapshot changed island fields in `root` under `pathKey`. Call BEFORE the body is swapped out. */
export function snapshot_forms(root: ParentNode, pathKey: string): void {
	close_restore(); // the page is left: its restore is over
	const recs: FieldRec[] = [];
	for (const [region, name] of region_names(root.querySelectorAll('ogygia-region'))) {
		for (const el of region.querySelectorAll(VALUE_SELECTOR)) {
			const f = el as HTMLInputElement;
			// Per-field opt-out: mark a field (or an ancestor) `data-ogygia-no-keep` to never restore
			// it — a fresh-message box, a one-time code, anything that should start blank each visit.
			if (f.closest(`[${OGYGIA_NO_KEEP}]`)) continue;
			const changed = is_checkable(f) ? f.checked !== f.defaultChecked : f.value !== f.defaultValue;
			if (!changed) continue;
			const addr = element_address(region, el);
			if (!addr) continue;
			recs.push({
				region: name,
				addr,
				tag: el.tagName,
				value: f.value,
				checked: is_checkable(f) ? f.checked : undefined
			});
		}
	}
	// (the store is bounded: past MAX_PAGES the least recently saved or read page goes)
	if (recs.length) store.set(pathKey, recs);
	else {
		store.delete(pathKey);
	}
}

function apply_region(region: Element, name: string, recs: FieldRec[]): void {
	for (const r of recs) {
		if (r.region !== name) continue;
		const el = resolve_address(region, r.addr);
		if (!el || el.tagName !== r.tag) continue;
		const f = el as HTMLInputElement;
		let changed = false;
		if (r.checked !== undefined) {
			if (f.checked !== r.checked) {
				f.checked = r.checked;
				changed = true;
			}
		} else if (f.value !== r.value) {
			f.value = r.value;
			changed = true;
		}
		if (changed) {
			f.dispatchEvent(new Event('input', { bubbles: true }));
			f.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}
}

/**
 * Arm restoration for `pathKey` on the freshly-connected page. Restores already-hydrated islands
 * immediately and hooks `ogygia:hydrated` for those still waking, for this page's restore window
 * (see `restore_window`).
 */
export function arm_form_restore(pathKey: string): void {
	close_restore(); // (one window at a time: a page before this one's is over)
	const recs = store.get(pathKey);
	if (!recs) return;
	// The page's region names read ONCE per arming (a read per hydrated island made each navigation
	// regions × regions); re-read only when a hydrated region is not named yet (a hole brought it).
	const read_names = () => region_names(document.querySelectorAll('ogygia-region'));
	let names = read_names();

	for (const [region, name] of names)
		if (region.hasAttribute('data-hydrated')) apply_region(region, name, recs);

	const on_hydrated = (e: Event) => {
		const region = e.target;
		if (!(region instanceof Element) || region.localName !== 'ogygia-region') return;
		if (!names.has(region)) names = read_names();
		const name = names.get(region);
		if (name !== undefined) apply_region(region, name, recs);
	};
	// (a hole's answer can put a copy of an island before another: read the names again after one)
	const on_answer = () => (names = read_names());
	restore_window.go('open');
	restore_window.scope.on(document, 'ogygia:hydrated', on_hydrated, true);
	restore_window.scope.on(document, 'ogygia:server', on_answer, true);
}
