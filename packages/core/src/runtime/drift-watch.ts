import { walk_enters } from './ownership.ts';

const REGION = 'ogygia-region';
const changed = new WeakSet<Element>();
let observer: MutationObserver | null = null;
let sleeping = 0;
const supported = typeof MutationObserver !== 'undefined';

function mark(records: MutationRecord[]): void {
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

/**
 * A region kept its server copy: watch until it wakes (pair with {@link unwatch_region}). One
 * `MutationObserver` over the document, running only while some region sleeps with a copy, marks a
 * region changed when a node or a text in it changes (attributes do not count, as the wake's
 * comparison ignores them), and every region around it too, up to an element whose inside Svelte's
 * walk never reads (`walk_enters`: a web component reworking its own light DOM there is not the
 * island drifting). The wake compares, and repairs, only a changed region (`region_changed`).
 */
export function watch_region(): void {
	if (!supported || ++sleeping > 1) return;
	// oxlint-disable-next-line ogygia/owned-effects -- one observer for the document, shared by every sleeping region: each region's sleep is its own (core.ts), and the last one to end disconnects it
	observer ??= new MutationObserver(mark);
	observer.observe(document.documentElement, {
		childList: true,
		characterData: true,
		subtree: true
	});
}

/** A region woke (or left): stop watching once none sleeps. */
export function unwatch_region(): void {
	if (!supported || sleeping === 0 || --sleeping > 0) return;
	if (observer) mark(observer.takeRecords());
	observer?.disconnect();
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
	if (observer && sleeping > 0) mark(observer.takeRecords());
	return changed.has(region);
}
