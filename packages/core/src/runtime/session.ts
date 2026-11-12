/**
 * Document-scoped runtime session: the head's owners, the settled lakes, and the page visit. What
 * belongs to one page (its lake caches, seed flags, kit-page probe) lives on its visit, and the next
 * page's swap (`reset()`) ends it, so connecting regions never see the previous page.
 */
import { cache, machine, scope, type Cache, type Scope } from '@ogygia/machine';
import { FROZEN_SELECTOR } from './region-attrs.ts';
import { note_visit } from './rules.ts';

/** Cap on lake cache entries (unique lake ids): past it, the one cached or refreshed longest ago
 *  goes (a read is a `peek`, never a use). */
const LAKE_CACHE_MAX = 64;

/** Cached SSR DOM (+ optional SWR endpoint) for `{#if}` remount of hydrate:none regions.
 * Keyed by lake entry id — size is O(unique lakes on the page), not O(toggles).
 * The page visit's: gone with it. SWR refresh replaces the entry (does not grow). */
export type LakeCacheEntry = {
	frag: Node;
	endpoint: string;
	when: string;
	/** `clock.mono()` when this entry was first cached or last successfully revalidated. */
	cachedAt: number;
	/** Client TTL in ms; `0` = no expiry. */
	maxAgeMs: number;
};

/**
 * A LAKE'S CONTENT, as the regions authored in it see it. `open`: its content is not in yet, and no
 * region waits. `waited`: not in, and regions connected in it wait. `settling`: in (the swap that
 * brought it is about to land), the ones that waited are not woken yet: woken before the swap, they
 * would run with no content. `settled`: in, and nobody waits.
 */
const LAKE = machine<{ open: {}; waited: {}; settling: {}; settled: {} }>()({
	name: 'lake',
	initial: 'open',
	steps: {
		open: ['waited', 'settled'],
		waited: ['settling', 'settled'],
		settling: ['settled'],
		settled: []
	}
});
type LakeMachine = ReturnType<typeof LAKE.create>;

/**
 * WHO OWNS EACH NODE IN `<head>` — the rule every head write and removal follows.
 *
 *   - The PAGE owns the head the server sent and everything the router or the runtime puts there for
 *     the page (merged heads, hoisted region sheets, preload links, hints). A navigation replaces
 *     page-owned nodes, and only those.
 *   - An ISLAND owns what its `<svelte:head>` renders live (csr=false: the island hydrates alone, so
 *     its head block renders fresh — hydrate-core.ts `neutralize_head_hydration_markers`). Only the
 *     island's own teardown removes those: Svelte deletes a head block by walking from its first node
 *     to its last, and if anyone else removes the last one first, the walk runs to the end of <head>
 *     and deletes the next page's tags with it (field: description / canonical / og:* gone after a
 *     client navigation).
 *   - Anything else (a third-party or dev-tooling inject) is not ours and is never removed — the rule
 *     SvelteKit's own router follows.
 *
 * And ONE copy: while an island's head content is live, the page's identical server copy of it is
 * retired (field: two identical JSON-LD blocks, duplicated inline CSS and preloads). Only page-owned
 * copies are ever retired — never an island's live node — and never a stylesheet link (removing either
 * copy could unstyle the page for a frame; a doubled sheet is harmless).
 */
const STYLESHEET_REL_RE = /(?:^|\s)stylesheet(?:\s|$)/i;

/**
 * THE PAGE VISIT: one per page the visitor is on, the document load, then each page a navigation
 * swaps in. It ends when the next page's swap takes over (`RuntimeSession.reset`). What the page
 * holds is its own and goes with it: on `scope`, its listeners, timers, observers and streams (the
 * router's link scan, the batch of its holes, the waits for the sheets its answers bring); in
 * `facts`, what its answers brought for its next hydrate.
 *
 * A navigation makes the visit of the page it brings before its swap (`RuntimeSession.next_visit`):
 * what it starts for that page early, the batch of its holes, is that visit's. A navigation that
 * ends without its swap (called off, taken over, given to the browser) ends that visit, never the
 * page's (./router-nav.ts `navigate`).
 */
export type PageVisit = {
	/** Closed when the visit ends. */
	readonly scope: Scope;
	/** The page facts answers rendered with (server/render-page.ts), queued at the answer seam
	 *  (`region_fragment`) for the next hydrate to merge into the page store (seeds.ts). This page's
	 *  only: the next page's visit starts with none (#269). */
	readonly facts: string[];
	/** Its seeds are in the stores (seeds.ts, remote-seeds.ts): read once per page. */
	readonly seeded: { page: boolean; remote: boolean };
	/** Kit hydrates this page (kit-boot.ts): asked once, on first need. */
	kit_page: boolean | undefined;
	/** Its lakes' cached server DOM, for an `{#if}` remount (./lakes.ts). */
	readonly lake_cache: Cache<string, LakeCacheEntry>;
	/** The lake ids whose first connect on this page ran (./lakes.ts). */
	readonly initialized_lakes: Set<string>;
};

// the runtime's rules (./rules.ts): dev, and a build made with OGYGIA_RULES=1; folds out elsewhere
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

function page_visit(): PageVisit {
	const owner = scope();
	const visit: PageVisit = {
		scope: owner,
		facts: [],
		seeded: { page: false, remote: false },
		kit_page: undefined,
		lake_cache: cache<string, LakeCacheEntry>({ name: 'lake cache', max: LAKE_CACHE_MAX, owner }),
		initialized_lakes: new Set()
	};
	if (RULES) note_visit(visit, false);
	return visit;
}

/** What one island's hydrate step put in `<head>` ({@link RuntimeSession.mark_head}). */
export interface HeadMark {
	/** The head's elements now that were not its children when the mark was made, in head order. */
	added(): Element[];
	/** Stop noting (a step that ended without a record). */
	stop(): void;
}

/**
 * The head's element children that a step added, from its child-list records: a node's first
 * record says whether it was a child before the step (removed first: it was; added first: it was
 * not), and it counts only if it is still a child at the end.
 */
function added_children(head: Element, records: MutationRecord[]): Element[] {
	const was_child = new Map<Node, boolean>();
	for (const r of records) {
		for (const n of r.removedNodes) if (!was_child.has(n)) was_child.set(n, true);
		for (const n of r.addedNodes) if (!was_child.has(n)) was_child.set(n, false);
	}
	const out: Element[] = [];
	for (const [n, was] of was_child)
		if (!was && n.nodeType === 1 && n.parentNode === head) out.push(n as Element);
	// (head order: what a scan of the head would have found)
	if (out.length > 1) out.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
	return out;
}

export class RuntimeSession {
	/** Page-owned head nodes (see above). Survives `reset()`: it is the document's, not a page's. */
	readonly page_head: WeakSet<Node> = new WeakSet<Node>();
	/** Island-owned head ELEMENTS still to watch (pruned when they leave the document). */
	readonly island_head: Set<Element> = new Set<Element>();

	/** Mark a node this document's page owns (the router / runtime inserted it for the page). */
	claim_page_head(node: Node): void {
		this.page_head.add(node);
	}

	/** At boot: everything already in <head> came from the server — the page owns it. */
	adopt_document_head(): void {
		if (typeof document === 'undefined') return;
		for (const n of document.head.children) this.page_head.add(n);
	}

	/**
	 * Before an island's hydrate step: start noting what lands in `<head>`. A MutationObserver on the
	 * head's own children, read synchronously when the step ends, so the record costs what the island
	 * added, not the whole head (a copy of the head per island grew as islands × head). Without
	 * MutationObserver: the head's elements, copied.
	 */
	mark_head(): HeadMark {
		const head = document.head;
		if (typeof MutationObserver === 'undefined') {
			const before = new Set<Node>(head.children);
			return {
				added: () => Array.from(head.children).filter((n) => !before.has(n)),
				stop: () => {}
			};
		}
		// (records the browser hands the callback before the step reads them are kept: the step is
		// synchronous, so none should be, but a lost record would be a node of the island's missed)
		const delivered: MutationRecord[] = [];
		// oxlint-disable-next-line ogygia/owned-effects -- the hydrate step's own: the mark it hands back disconnects it (`added`, `stop`)
		const watch = new MutationObserver((records) => delivered.push(...records));
		watch.observe(head, { childList: true });
		return {
			added: () => {
				const records = delivered.concat(watch.takeRecords());
				watch.disconnect();
				return added_children(head, records);
			},
			stop: () => watch.disconnect()
		};
	}

	/** After an island's hydrate: the head elements it added (not there before the step, not
	 *  page-owned) are that island's; then retire the page's copies of them. */
	record_island_head(mark: HeadMark): void {
		let added = false;
		for (const n of mark.added()) {
			if (!this.page_head.has(n)) {
				this.island_head.add(n);
				added = true;
			}
		}
		// (an island that added nothing to the head has no page copy to retire: no serializing every
		// page head element on each of the page's hydrates)
		if (added) this.retire_page_head_copies();
	}

	/**
	 * Remove every PAGE-owned head element that duplicates a live island-owned one (same markup), and
	 * the page's `<title>` once an island renders its own (the browser honours the first title, and
	 * the island's is the reactive one). Runs after an island hydrates and after a navigation merge.
	 */
	retire_page_head_copies(): void {
		const live = new Set<string>();
		let island_title = false;
		for (const el of this.island_head) {
			if (!el.isConnected) {
				this.island_head.delete(el);
				continue;
			}
			live.add(el.outerHTML);
			if (el.localName === 'title') island_title = true;
		}
		if (live.size === 0) return;
		for (const el of Array.from(document.head.children)) {
			if (!this.page_head.has(el)) continue;
			if (el.localName === 'link' && STYLESHEET_REL_RE.test(el.getAttribute('rel') ?? '')) continue;
			if ((island_title && el.localName === 'title') || live.has(el.outerHTML)) el.remove();
		}
	}

	/** Each lake element's {@link LAKE} machine, made the first time it is asked about. */
	#lakes = new WeakMap<Element, LakeMachine>();
	#lake(el: Element): LakeMachine {
		let m = this.#lakes.get(el);
		if (m === undefined) this.#lakes.set(el, (m = LAKE.create()));
		return m;
	}

	/** May the regions authored in this lake run (its content is in, or it never gets any)? */
	lake_settled(el: Element): boolean {
		const kind = this.#lakes.get(el)?.now.kind;
		return kind === 'settled' || kind === 'settling';
	}

	/** The lake's content is in: the regions that connect in it from now on run. Ones that already
	 *  waited are woken by {@link wake_lake} after the swap that brings their content. */
	settle_lake(el: Element): void {
		const m = this.#lake(el);
		if (m.now.kind === 'open') m.go('settled');
		else if (m.now.kind === 'waited') m.go('settling');
	}

	/** A region in an unsettled lake waits on it: `true` when it must (the lake is not settled). */
	wait_on_lake(el: Element): boolean {
		const m = this.#lake(el);
		if (m.now.kind === 'open') m.go('waited');
		return m.now.kind === 'waited';
	}

	/** After the lake's swap: `true` when regions waited on it and are to be woken now. */
	wake_lake(el: Element): boolean {
		const m = this.#lakes.get(el);
		if (m === undefined || (m.now.kind !== 'settling' && m.now.kind !== 'waited')) return false;
		m.go('settled');
		return true;
	}

	/** The lake gives up on new content (its refresh failed for good): settled as it stands. */
	settle_lake_now(el: Element): void {
		const m = this.#lake(el);
		if (m.now.kind !== 'settled') m.go('settled');
	}

	#visit: PageVisit = page_visit();
	/** The visit of the page on screen (see {@link PageVisit}). */
	get visit(): PageVisit {
		return this.#visit;
	}

	/** The visit of the page a navigation brings, made before its swap: the navigation's (it ends
	 *  it when there is no swap) until `reset(next)` makes it the page. */
	next_visit(): PageVisit {
		return page_visit();
	}

	// (what follows is the page's on screen: its visit's, gone with it)

	get lake_cache(): Cache<string, LakeCacheEntry> {
		return this.#visit.lake_cache;
	}
	get initialized_lakes(): Set<string> {
		return this.#visit.initialized_lakes;
	}

	get remote_seeded(): boolean {
		return this.#visit.seeded.remote;
	}
	mark_remote_seeded(): void {
		this.#visit.seeded.remote = true;
	}

	get page_seeded(): boolean {
		return this.#visit.seeded.page;
	}
	mark_page_seeded(): void {
		this.#visit.seeded.page = true;
	}

	get kit_page(): boolean | undefined {
		return this.#visit.kit_page;
	}
	set kit_page(v: boolean | undefined) {
		this.#visit.kit_page = v;
	}

	settle_lakes_in(root: ParentNode): void {
		if (root instanceof Element && root.matches?.(FROZEN_SELECTOR)) this.settle_lake(root);
		for (const lake of root.querySelectorAll(FROZEN_SELECTOR)) this.settle_lake(lake);
	}

	/** The next page takes over (its visit, made by its navigation; a new one when none is given),
	 *  and the visit of the page it replaces ends. */
	reset(next: PageVisit = page_visit()): void {
		const left = this.#visit;
		this.#visit = next;
		if (RULES) note_visit(next, true);
		if (left !== next) left.scope.close();
	}
}

/** Process-wide session for the islands runtime (one client module graph). */
export const runtime_session: RuntimeSession = new RuntimeSession();
