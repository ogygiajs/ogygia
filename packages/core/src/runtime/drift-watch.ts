import { registry, type Scope } from '@ogygia/machine';
import { walk_enters } from './ownership.ts';

const REGION = 'ogygia-region';
const changed = new WeakSet<Element>();
let observer: MutationObserver | null = null;
/** The regions sleeping with a copy: each held while its sleep is open. */
const sleepers = registry<Element>();
const supported = typeof MutationObserver !== 'undefined';
const WATCHED: MutationObserverInit = { childList: true, characterData: true, subtree: true };

function note_island_touched(records: MutationRecord[]): void {
	for (const r of records) {
		let hidden = false;
		for (let n: Node | null = r.target; n; n = n.parentNode) {
			if (n.nodeType !== 1) continue;
			const el = n as Element;
			if (el.localName === REGION && !hidden) changed.add(el);
			if (!hidden && !walk_enters(el)) hidden = true;
		}
	}
}

function rewatch(): void {
	if (!observer) return;
	note_island_touched(observer.takeRecords());
	observer.disconnect();
	for (const region of sleepers) observer.observe(region, WATCHED);
}

/**
 * `region` kept its server copy: watch it while `sleep` is open (until it wakes, or leaves the page).
 * One `MutationObserver` over the sleeping regions' own subtrees marks a region changed when a node
 * or a text in it changes (attributes do not count, as the wake's comparison ignores them), and every
 * region around it too, up to an element whose inside Svelte's walk never reads (`walk_enters`: a web
 * component reworking its own light DOM there is not the island drifting). The wake compares, and
 * repairs, only a changed region (`region_changed`).
 */
export function watch_region(sleep: Scope, region: Element): void {
	if (!supported || sleep.closed) return;
	sleepers.add(region, sleep);
	// (the registry's entry is a child of `sleep`: it has left by the time this runs)
	sleep.defer(rewatch);
	// oxlint-disable-next-line ogygia/owned-effects -- one observer for every sleeping region: each region's sleep owns its place in `sleepers`, and each sleep's end watches only the regions left
	observer ??= new MutationObserver(note_island_touched);
	observer.observe(region, WATCHED);
}

/** The region's copy is stale (it left the document while it slept): compare it at the wake. */
export function mark_region_changed(region: Element): void {
	changed.add(region);
}

/** Was anything in this region's markup touched since it kept its copy? Read at the wake, BEFORE the
 *  runtime itself edits the island (lakes lifted): the pending records are taken first, so nothing is
 *  decided by timing. In a browser without MutationObserver, always true: every region compares. */
export function region_changed(region: Element): boolean {
	if (!supported) return true;
	if (observer) note_island_touched(observer.takeRecords());
	return changed.has(region);
}
