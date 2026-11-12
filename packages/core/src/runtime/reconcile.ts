/**
 * State-delta reconciler — R0: region identity + change detection (client-side, no SSR change).
 *
 * A navigation should MOVE regions, not reset them. To decide keep/patch/mount/remove per region
 * (R1), the reconciler needs two derived keys off each `<ogygia-region>` — computed purely from
 * attributes the compiler already emits (which is untouchable), never from live-mutated innerHTML:
 *
 *   • signature   — WHICH region slot this is (the match key). entry (component chunk) + the
 *                   endpoint's stable id/props part. Two regions with the same signature are
 *                   candidates for the same slot; document-order position (R1's diff) disambiguates
 *                   duplicate signatures.
 *   • props_fp    — DID ITS INPUTS CHANGE. A hash of the SSR seed: entry + endpoint + the
 *                   `<script data-ogygia-props>` text that follows the region. The seed is stable
 *                   across hydration (islands read it, never rewrite it), so comparing old↔new
 *                   props_fp answers "does the new page feed this region the same props?" — if yes,
 *                   the live island (which may hold interaction state the SSR html lacks) is the
 *                   source of truth and is KEPT; if no, the region is PATCHED.
 *
 * Pure and DOM-light: the hashing core takes strings so it unit-tests without a document.
 */

import { dispose_ids } from '../ref.ts';
import { boot_link, morph_sync_attributes, slots } from './slots.ts';
import { ids_released } from './region-ids.ts';
import { emit as dt_emit } from '../events/bus.ts';
import { OG_FP, OG_NO_RECONCILE, OGYGIA_KEEP } from '../wire-markup.ts';

// DEVTOOLS gate — module-local const from the Vite `define` (proven DCE pattern); off → folds out.
const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
// The pure fingerprint core lives in its own dep-free module so the SERVER (Region.svelte) can
// import it and compute IDENTICAL fingerprints (server-delta nav parity). Re-exported for existing
// importers of these from reconcile.ts.
import { fnv1a, endpoint_key, signature_of, fingerprint_of } from '../contract/hash.ts';
export { fnv1a, endpoint_key, signature_of, fingerprint_of };

// Boot helpers (the sidecar lookup) and morph's attribute sync, handed over through the registry —
// the navigation's reconcile never imports a boot module (./slots.ts `BootLink`).
const props_sidecar_of = (region: Element) => boot_link().props_sidecar_of(region);
/**
 * `<body>` has two owners (runtime/ownership.ts): the server, page by page (a theme class, a layout
 * flag, the content), and the scripts living on the page (a scroll lock, a consent banner's state; a
 * component mounted into the body, such as a popover's portal). A navigation moves the server's part
 * to the new page's and leaves the page's part alone:
 *  - ATTRIBUTES: it removes only those the PREVIOUS page's server sent that the new one doesn't;
 *  - CHILDREN: the morph steps over a child the server never sent (a portal's mount anchor: taking
 *    it away leaves the portal inserting its content beside a detached node, so a popover in a kept
 *    island never opens again).
 * ONE record per reconciled root (ownership.ts `record_server_body`), reached through the boot
 * registry like every boot helper this lazy chunk uses: the router takes the body's when it starts,
 * before any island wakes; each reconcile renews its root's (a harness driving it on its own root
 * gets one from its first call). A root with no record yet is all the server's: every child is
 * matched, and no attribute is taken away.
 */

/** The record of what the server last sent `live`, or null while there is none. */
function body_record(live: Element) {
	const link = slots.boot;
	return link && link.server_body_attributes(live) !== null ? link : null;
}

function sync_body_attributes(live: Element, next: Element): void {
	morph_sync_attributes()(live, next, true); // add + update what the new page sends
	const sent = body_record(live)?.server_body_attributes(live);
	if (sent) for (const name of sent) if (!next.hasAttribute(name)) live.removeAttribute(name);
}

/** The live body's children that are the page's own, not the server's (none without a record). */
function page_own_children(live: Element): Set<Node> {
	const own = new Set<Node>();
	const record = body_record(live);
	if (record === null) return own;
	for (let n = live.firstChild; n; n = n.nextSibling) if (!record.server_body_child(n)) own.add(n);
	return own;
}

/** After a navigation the server's body is the new page's: its attributes, and every live child that
 *  is not the page's own. */
function renew_server_body(live: Element, next: Element, own: ReadonlySet<Node>): void {
	const link = slots.boot;
	if (!link) return;
	const children: Node[] = [];
	for (let n = live.firstChild; n; n = n.nextSibling) if (!own.has(n)) children.push(n);
	link.record_server_body(live, next, children);
}

/** The `<script data-ogygia-props>` seed text of a region — keyed at the end of the body or the
 *  adjacent sibling (runtime/sidecar.ts) — or '' — the same lookup the hydrator uses, read-only.
 *  SSR-stable across hydration. */
export function region_props_text(el: Element): string {
	return props_sidecar_of(el)?.textContent ?? '';
}

/** Match key for a rendered region element (which slot). */
export function region_signature(el: Element): string {
	return signature_of(el.getAttribute('entry') ?? '', el.getAttribute('endpoint') ?? '');
}

/**
 * THE region identity — did its inputs change / which instance is this. ONE value, not a recompute:
 * the server already emitted it as `data-og-fp` (Region.svelte), so READ that. Only fall back to
 * computing it when the attribute is absent (a region type that doesn't emit it). Reading the
 * server's value makes client↔server parity EXACT by construction — no divergence between
 * `fingerprint_of(...)` here and the server's emit is possible, which is the correctness property
 * the server-delta skip decision rides on.
 */
export function region_props_fp(el: Element): string {
	const emitted = el.getAttribute(OG_FP);
	if (emitted !== null && emitted !== '') return emitted;
	return fingerprint_of(
		el.getAttribute('entry') ?? '',
		el.getAttribute('endpoint') ?? '',
		region_props_text(el)
	);
}

// ── R1: reconcile a live body toward a freshly parsed one, in place ──────────────────────────
//
// The whole diff reduces to STAMPING and letting morph do the work. morph already (a) keyed-matches
// by data-key, (b) preserves hydrated islands + persist/keep chrome without recursing, (c) morphs
// the shell in place with focus/scroll/selection intact. So: stamp every region with a data-key that
// encodes signature + props-fingerprint, and morph naturally does keep/patch/mount/remove:
//   • unchanged region → same key old↔new → morph keeps the live (hydrated) node. KEEP.
//   • changed props    → different key    → morph removes old, inserts fresh. PATCH (re-hydrates).
//   • only in new      → no old match     → inserted. MOUNT.
//   • only in old      → no new match     → removed. REMOVE.
// Keep-chrome is stamped by its keep name so it matches by identity, not position.

const RECONCILE_KEY = 'data-key';

/** Stamp reconcile keys onto a root's regions + keep-chrome, without clobbering an authored key/id.
 *  A region's key is its identity (fingerprint, or signature for a persisted one) plus which copy of
 *  it it is; keep-chrome keys by keep name. */
export function stamp_region_keys(root: ParentNode): void {
	const regions = root.querySelectorAll('ogygia-region');
	// A key names ONE region: identical regions (same component, same props) share a fingerprint, and
	// a shared key let the morph match both to one node, so a page left with two of them kept one
	// (#807). The first copy keeps the bare identity, a later copy adds its place among the copies in
	// document order, the same on the live page and the incoming one. Keys already stamped (a region
	// kept from an earlier navigation) are taken first, so a new copy never repeats one.
	const taken = new Set<string>();
	for (const el of regions) {
		const k = el.getAttribute(RECONCILE_KEY);
		if (k !== null) taken.add(k);
	}
	const copies = new Map<string, number>();
	const stamp = (el: Element, identity: string): void => {
		let n = copies.get(identity) ?? 0;
		let key = n === 0 ? identity : `${identity} ${n}`;
		while (taken.has(key)) key = `${identity} ${++n}`;
		copies.set(identity, n + 1);
		taken.add(key);
		el.setAttribute(RECONCILE_KEY, key);
	};
	for (const el of regions) {
		if (el.getAttribute(RECONCILE_KEY) !== null || el.id !== '') continue;
		// A KEPT region (keep:'name' / data-persist) keys by its STABLE identity so a props change
		// (e.g. a `track` prop following the route) KEEPS the live island and prop-pushes the new
		// props into it — NOT re-mounts it (which resets state, breaking the persist contract). Only
		// a NON-kept region keys by props-fingerprint (patch when its inputs change).
		const keep = el.getAttribute(OGYGIA_KEEP);
		if (keep !== null) {
			el.setAttribute(RECONCILE_KEY, `k\0${keep}`);
		} else if (el.hasAttribute('data-persist')) {
			stamp(el, `p\0${region_signature(el)}`);
		} else {
			// One identity: the 64-bit fingerprint alone. It already hashes entry + endpoint + props,
			// so the old signature+fp encoded entry twice — the fp is the whole key now, and 64 bits
			// makes a cross-slot collision a non-risk.
			stamp(el, `r\0${region_props_fp(el)}`);
		}
	}
	for (const el of root.querySelectorAll(`[${OGYGIA_KEEP}]`)) {
		if (el.getAttribute(RECONCILE_KEY) !== null || el.id !== '') continue;
		el.setAttribute(RECONCILE_KEY, `k\0${el.getAttribute(OGYGIA_KEEP) ?? ''}`);
	}
}

/**
 * SHADOW-DOM SAFETY: reconcile (querySelectorAll + morph) does NOT pierce shadow boundaries, so a
 * region rendered INSIDE a shadow root (a web component's own template) would be invisible to it —
 * morph would keep the stale host and never update that region. The router decides the fallback
 * from a count, not a walk: the runtime keeps the set of CONNECTED regions (every region connects,
 * shadow or light), the light DOM is one `querySelectorAll`; a mismatch means a region lives in a
 * shadow root. An author forces the fallback with `data-og-no-reconcile` — the only thing checked
 * here, on either document.
 */
export const NO_RECONCILE_SELECTOR: string = `[${OG_NO_RECONCILE}]`;

/** Reconcile the live body toward the parsed next body IN PLACE (no replaceWith). `morph` is the
 *  keyed morpher (slots.morph / morph_children). After this, `live` IS the reconciled tree: matched
 *  regions kept live, changed regions re-mounted, shell morphed. Region ownership of hub ids (R3)
 *  lives in ./region-ids.ts. */

/**
 * DEVTOOLS (nav lab): classify each region's fate under this reconcile — keep | patch | mount |
 * remove — and emit one `nav.reconcile` per region. Matched reconcile keys are KEPT; the rest are
 * grouped by SIGNATURE (which slot), so a same-slot pair (props changed → different fp key) reads as
 * a PATCH, a leftover old-only as REMOVE, a leftover new-only as MOUNT. Called only behind the gate,
 * before morph mutates the trees. Cheap: attribute reads + set math, once per nav.
 */
function dt_emit_reconcile(live: Element, next: Element): void {
	const key = (el: Element) => el.getAttribute('data-key') ?? '';
	// Carry the region's entry + wake on the event so the nav lab can label the decision by component
	// NAME (and strategy) instead of a raw `r\0<fp>` key.
	const rec = (el: Element, decision: 'keep' | 'patch' | 'mount' | 'remove') =>
		dt_emit({
			domain: 'nav',
			name: 'nav.reconcile',
			key: key(el),
			decision,
			entry: el.getAttribute('entry') ?? undefined,
			wake: el.getAttribute('wake') ?? undefined
		});
	const live_els = Array.from(live.querySelectorAll('ogygia-region'));
	const next_els = Array.from(next.querySelectorAll('ogygia-region'));
	const live_keys = new Set(live_els.map(key));
	const next_key_set = new Set(next_els.map(key));
	for (const el of next_els) {
		if (live_keys.has(key(el))) rec(el, 'keep');
	}
	// Old-only / new-only, grouped by slot signature to pair patches.
	const group = (els: Element[], only: Set<string>) => {
		const m = new Map<string, Element[]>();
		for (const el of els) {
			if (only.has(key(el))) continue;
			const sig = region_signature(el);
			(m.get(sig) ?? m.set(sig, []).get(sig)!).push(el);
		}
		return m;
	};
	const old_by_sig = group(live_els, next_key_set);
	const new_by_sig = group(next_els, live_keys);
	const sigs = new Set([...old_by_sig.keys(), ...new_by_sig.keys()]);
	for (const sig of sigs) {
		const olds = old_by_sig.get(sig) ?? [];
		const news = new_by_sig.get(sig) ?? [];
		const pairs = Math.min(olds.length, news.length);
		for (let i = 0; i < pairs; i++) rec(news[i], 'patch');
		for (let i = pairs; i < olds.length; i++) rec(olds[i], 'remove');
		for (let i = pairs; i < news.length; i++) rec(news[i], 'mount');
	}
}

export function reconcile_body(
	live: Element,
	next: Element,
	morph: (
		parent: Element,
		nodes: ArrayLike<Node>,
		options?: { stays?: (node: Node) => boolean }
	) => void
): void {
	stamp_region_keys(live);
	stamp_region_keys(next);
	// (read first: the record still describes the leaving page)
	const own = page_own_children(live);
	// The morph reconciles body's CHILDREN, never body's own attributes — sync them so a route that
	// changes `<body class>` / `data-*` (theme, layout flags) takes effect on nav, keeping the live
	// body node (and everything hung on it) intact. outerSync's attribute half, applied in place —
	// the server's attributes only (see sync_body_attributes).
	sync_body_attributes(live, next);
	if (DEVTOOLS) dt_emit_reconcile(live, next);
	// R3 SELECTIVE DISPOSE: a reconcile keeps matched islands, so it can't blanket-dispose the page
	// scope. Collect the REMOVED regions (live keys absent from next — a patched region counts here
	// too, its fp-key changed) so we can tear down what only they owned after the morph.
	const next_keys = new Set<string>();
	for (const el of next.querySelectorAll('ogygia-region')) {
		const k = el.getAttribute('data-key');
		if (k !== null) next_keys.add(k);
	}
	const departed: Element[] = [];
	for (const el of live.querySelectorAll('ogygia-region')) {
		const k = el.getAttribute('data-key');
		if (k !== null && next_keys.has(k)) continue; // kept/matched — its ids survive
		departed.push(el);
	}
	// PROP-PUSH for KEPT regions (the persist contract): a kept region's live island stays mounted,
	// so morph never delivers the new page's props to it. Before morph discards the incoming nodes,
	// pair kept regions old↔new by their reconcile key and let the live island ABSORB the incoming
	// props (same `absorbKeptProps` hook persist.relocate used) — so a persisted player reflects
	// the new route instead of freezing at first-mount props.
	absorb_kept_props(live, next);
	// The page's own children stay where they are; the server's reconcile toward the next page.
	morph(live, next.childNodes, own.size > 0 ? { stays: (n) => own.has(n) } : undefined);
	renew_server_body(live, next, own);
	// REMOVED regions are gone from the DOM now — tear down their page-scoped hub instances
	// (session-aliased continuity instances are skipped inside dispose_ids).
	// An id a kept region also owns (one object shared by two regions) stays with it (#815).
	const released = ids_released(departed, live);
	if (released.length > 0) dispose_ids(released);
}

/**
 * outerSync body swap — the FALLBACK path (reconcile off, or a region trapped in a shadow root the
 * morph can't pierce). The old code did `document.body.replaceWith(doc.body)`, which THROWS AWAY the
 * live `<body>` element — and with it every listener, observer, and dataset value anything (Kit,
 * analytics, a scroll library) attached to `document.body`. htmx 4 boosts land the same way and use
 * `outerSync` for exactly this reason: keep the element, sync its attributes, replace its children.
 * So we do too — the live body node survives, only its guts change. Incoming children are moved out
 * of the parsed document (insertion adopts them across documents). The page's own children (a
 * portal's anchor) stay, as in the reconcile; the server's are replaced.
 */
export function swap_body(live: HTMLElement, next: HTMLElement): void {
	const own = page_own_children(live);
	sync_body_attributes(live, next);
	if (own.size === 0) {
		live.replaceChildren(); // drop the old subtree
	} else {
		for (let n = live.firstChild; n;) {
			const here = n;
			n = n.nextSibling;
			if (!own.has(here)) live.removeChild(here);
		}
	}
	while (next.firstChild) live.appendChild(next.firstChild); // adopt the incoming children in order
	renew_server_body(live, next, own);
}

/** Reflect for a Region custom element that can pull fresh props from an incoming twin. */
type Absorbable = Element & { absorbKeptProps?: (incoming: Element) => void };

/** For each live region whose reconcile key also appears in `next`, push the incoming region's
 *  props into the live island (kept regions only — a re-mounting region gets its props on mount),
 *  and its fingerprint, the name of those props: the sidecar is found by it and the router lists a
 *  page's islands by it (#1067). The morph never enters a kept region, so it syncs neither. */
function absorb_kept_props(live: Element, next: Element): void {
	const incoming = new Map<string, Element>();
	for (const el of next.querySelectorAll('ogygia-region')) {
		const k = el.getAttribute('data-key');
		if (k !== null && !incoming.has(k)) incoming.set(k, el);
	}
	for (const el of live.querySelectorAll('ogygia-region')) {
		const k = el.getAttribute('data-key');
		if (k === null) continue;
		const twin = incoming.get(k);
		if (twin === undefined || twin === el) continue;
		const absorb = (el as Absorbable).absorbKeptProps;
		if (typeof absorb === 'function') absorb.call(el, twin);
		const fp = twin.getAttribute(OG_FP);
		if (fp === null) el.removeAttribute(OG_FP);
		else if (el.getAttribute(OG_FP) !== fp) el.setAttribute(OG_FP, fp);
	}
}
