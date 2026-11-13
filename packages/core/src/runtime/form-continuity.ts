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
 * Only DIFFS are stored (default → nothing), bounded page count, so this stays cheap. A field marked
 * `data-ogygia-no-keep` (or inside one) is never kept: a fresh-message box, a one-time code. A page's
 * restore window is one at a time and ends when the page is left, so a page's values never reach the
 * next page's islands. test/browser/form-restore-region-identity.test.ts.
 *
 * @packageDocumentation
 */
import { cache, machine } from '@ogygia/machine';
import { element_address, resolve_address } from './interaction.ts';
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
	region: string;
	addr: number[];
	tag: string;
	value: string;
	checked: boolean | undefined;
};

const store = cache<string, FieldRec[]>({ name: 'form continuity', max: MAX_PAGES });

const RESTORE_WINDOW_MS = 5000;

const restore_window = machine<{ idle: {}; open: {} }>()({
	name: 'form-restore',
	initial: 'idle',
	steps: { idle: ['open'], open: ['idle'] },
	after: { open: { ms: RESTORE_WINDOW_MS, to: 'idle' } }
}).create();

function close_restore(): void {
	if (restore_window.now.kind === 'open') restore_window.go('idle');
}

const is_checkable = (f: HTMLInputElement) => f.type === 'checkbox' || f.type === 'radio';

function url_of(value: string | null): URL | null {
	if (!value) return null;
	try {
		return new URL(value, document.baseURI);
	} catch {
		return null; // ok: not a URL; the name goes without it
	}
}

function region_kind(region: Element): string {
	const entry = url_of(region.getAttribute('entry'));
	const endpoint = url_of(region.getAttribute('endpoint'));
	return `${entry ? entry.pathname : ''} ${endpoint ? `${endpoint.pathname}?${endpoint.searchParams.get('id') ?? ''}` : ''}`;
}

function region_names(regions: Iterable<Element>): Map<Element, string> {
	const copies = new Map<string, number>();
	const names = new Map<Element, string>();
	for (const region of regions) {
		const signature = region_kind(region);
		const n = copies.get(signature) ?? 0;
		copies.set(signature, n + 1);
		names.set(region, `${n} ${signature}`);
	}
	return names;
}

/** Snapshot changed island fields in `root` under `pathKey`. Call BEFORE the body is swapped out. */
export function snapshot_forms(root: ParentNode, pathKey: string): void {
	close_restore();
	const recs: FieldRec[] = [];
	for (const [region, name] of region_names(root.querySelectorAll('ogygia-region'))) {
		for (const el of region.querySelectorAll(VALUE_SELECTOR)) {
			const f = el as HTMLInputElement;
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
	close_restore();
	const recs = store.get(pathKey);
	if (!recs) return;
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
	const on_answer = () => (names = read_names());
	restore_window.go('open');
	restore_window.scope.on(document, 'ogygia:hydrated', on_hydrated, true);
	restore_window.scope.on(document, 'ogygia:server', on_answer, true);
}
