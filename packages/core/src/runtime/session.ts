/**
 * Document-scoped runtime session: the head's owners, the settled lakes, and the page visit. What
 * belongs to one page (its lake caches, seed flags, kit-page probe) lives on its visit, and the next
 * page's swap (`reset()`) ends it, so connecting regions never see the previous page.
 *
 * A lake's content, as the regions authored in it see it: `open` (not in yet, no region waits),
 * `waited` (not in, regions wait), `settling` (in, the swap that brought it about to land: the ones
 * that waited are not woken yet, as woken before the swap they would run with no content), `settled`.
 *
 * WHO OWNS EACH NODE IN `<head>`, the rule every head write and removal follows:
 *
 *   - The PAGE owns the head the server sent and everything the router or the runtime puts there for
 *     the page (merged heads, hoisted region sheets, preload links, hints). A navigation replaces
 *     page-owned nodes, and only those.
 *   - An ISLAND owns what its `<svelte:head>` renders live (csr=false: the island hydrates alone, so
 *     its head block renders fresh, hydrate-core.ts `neutralize_head_hydration_markers`). Only the
 *     island's own teardown removes those: Svelte deletes a head block by walking from its first node
 *     to its last, and if anyone else removes the last one first, the walk runs to the end of <head>
 *     and deletes the next page's tags with it.
 *   - Anything else (a third-party or dev-tooling inject) is not ours and is never removed, the rule
 *     SvelteKit's own router follows.
 *
 * And ONE copy: while an island's head content is live, the page's identical server copy of it is
 * retired. Only page-owned copies are ever retired, never an island's live node, and never a
 * stylesheet link (removing either copy could unstyle the page for a frame; a doubled sheet is
 * harmless). Two copies are the same by tag, attributes in order, and content, where an element with
 * no element children is read by its text with the ends trimmed (the client's compiled template
 * trims what the server wrote as the source has it). An island's fresh head block moves, as one run,
 * to where the page's copy stood, so islands' head content keeps the server's order, not the order
 * they woke; a run another node stands inside stays where Svelte put it.
 *
 * Tests: test/browser/head-ownership.test.ts, test/browser/island-head-order.test.ts.
 *
 * @packageDocumentation
 */
import { cache, machine, scope, type Cache, type Scope } from '@ogygia/machine';
import { FROZEN_SELECTOR } from './region-attrs.ts';
import { note_visit } from './rules.ts';

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

const STYLESHEET_REL_RE = /(?:^|\s)stylesheet(?:\s|$)/i;

function head_copy_key(el: Element): string {
	const key = `${el.localName}${Array.from(el.attributes, (a) => `\0${a.name}\0${a.value}`).join('')}`;
	return el.childElementCount === 0
		? `${key}\0\0t${(el.textContent ?? '').trim()}`
		: `${key}\0\0h${el.innerHTML}`;
}

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
	/** The same, every node (an island's head block is its elements and Svelte's text anchor). */
	nodes(): Node[];
	/** Stop noting (a step that ended without a record). */
	stop(): void;
}

function added_children(head: Element, records: MutationRecord[]): Node[] {
	const was_child = new Map<Node, boolean>();
	for (const r of records) {
		for (const n of r.removedNodes) if (!was_child.has(n)) was_child.set(n, true);
		for (const n of r.addedNodes) if (!was_child.has(n)) was_child.set(n, false);
	}
	const out: Node[] = [];
	for (const [n, was] of was_child) if (!was && n.parentNode === head) out.push(n);
	if (out.length > 1) out.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
	return out;
}

function take_page_slot(nodes: Node[], own: Element[], page_head: WeakSet<Node>): void {
	const head = document.head;
	const first = nodes[0];
	const last = nodes[nodes.length - 1];
	const run = new Set(nodes);
	for (let n: Node | null = first; n !== last; n = n.nextSibling)
		if (n === null || !run.has(n)) return;
	const keys = new Set<string>();
	for (const el of own) keys.add(head_copy_key(el));
	for (const el of head.children) {
		if (run.has(el) || !page_head.has(el) || !keys.has(head_copy_key(el))) continue;
		for (const n of nodes) head.insertBefore(n, el);
		return;
	}
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
		let taken: Node[] | null = null;
		let take: () => Node[];
		let stop = (): void => {};
		if (typeof MutationObserver === 'undefined') {
			const before = new Set<Node>(head.childNodes);
			take = () => Array.from(head.childNodes).filter((n) => !before.has(n));
		} else {
			const delivered: MutationRecord[] = [];
			// oxlint-disable-next-line ogygia/owned-effects -- the hydrate step's own: the mark it hands back disconnects it (`added`, `nodes`, `stop`)
			const watch = new MutationObserver((records) => delivered.push(...records));
			watch.observe(head, { childList: true });
			stop = () => watch.disconnect();
			take = () => {
				const records = delivered.concat(watch.takeRecords());
				watch.disconnect();
				return added_children(head, records);
			};
		}
		const nodes = (): Node[] => (taken ??= take());
		return {
			added: () => nodes().filter((n): n is Element => n.nodeType === 1),
			nodes,
			stop
		};
	}

	/** After an island's hydrate: the head elements it added (not there before the step, not
	 *  page-owned) are that island's; they take the place of the page's copy of them, which is
	 *  retired. */
	record_island_head(mark: HeadMark): void {
		const own: Element[] = [];
		for (const n of mark.added()) {
			if (!this.page_head.has(n)) {
				this.island_head.add(n);
				own.push(n);
			}
		}
		if (own.length === 0) return;
		take_page_slot(mark.nodes(), own, this.page_head);
		this.retire_page_head_copies();
	}

	/**
	 * Remove every PAGE-owned head element that duplicates a live island-owned one ({@link head_copy_key}), and
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
			live.add(head_copy_key(el));
			if (el.localName === 'title') island_title = true;
		}
		if (live.size === 0) return;
		for (const el of Array.from(document.head.children)) {
			if (!this.page_head.has(el)) continue;
			if (el.localName === 'link' && STYLESHEET_REL_RE.test(el.getAttribute('rel') ?? '')) continue;
			if ((island_title && el.localName === 'title') || live.has(head_copy_key(el))) el.remove();
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

	/** The lake's content is in now (put back by its host, swapped in by a navigation, there as it
	 *  stands, or kept after a refresh failed for good): every region in it runs. Ones that waited came
	 *  back with the content (moved, they reconnect) or are woken by the caller. */
	settle_lake(el: Element): void {
		const m = this.#lake(el);
		if (m.now.kind !== 'settled') m.go('settled');
	}

	/** A refresh's answer is in hand, its swap not done: the regions that connect from now on run (they
	 *  come with the swap), and the ones that waited are woken by {@link wake_lake} after it. */
	settle_lake_before_swap(el: Element): void {
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
