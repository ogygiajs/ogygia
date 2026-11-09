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
import { fnv1a, endpoint_key, signature_of, fingerprint_of } from './hash.ts';
export { fnv1a, endpoint_key, signature_of, fingerprint_of };
/** The `<script data-ogygia-props>` seed text of a region — keyed at the end of the body or the
 *  adjacent sibling (runtime/sidecar.ts) — or '' — the same lookup the hydrator uses, read-only.
 *  SSR-stable across hydration. */
export declare function region_props_text(el: Element): string;
/** Match key for a rendered region element (which slot). */
export declare function region_signature(el: Element): string;
/**
 * THE region identity — did its inputs change / which instance is this. ONE value, not a recompute:
 * the server already emitted it as `data-og-fp` (Region.svelte), so READ that. Only fall back to
 * computing it when the attribute is absent (a region type that doesn't emit it). Reading the
 * server's value makes client↔server parity EXACT by construction — no divergence between
 * `fingerprint_of(...)` here and the server's emit is possible, which is the correctness property
 * the server-delta skip decision rides on.
 */
export declare function region_props_fp(el: Element): string;
/** Stamp reconcile keys onto a root's regions + keep-chrome, without clobbering an authored key/id.
 *  A region's key is signature+fingerprint (patch on either change); keep-chrome keys by keep name. */
export declare function stamp_region_keys(root: ParentNode): void;
/**
 * SHADOW-DOM SAFETY: reconcile (querySelectorAll + morph) does NOT pierce shadow boundaries, so a
 * region rendered INSIDE a shadow root (a web component's own template) would be invisible to it —
 * morph would keep the stale host and never update that region. The router decides the fallback
 * from a count, not a walk: the runtime keeps the set of CONNECTED regions (every region connects,
 * shadow or light), the light DOM is one `querySelectorAll`; a mismatch means a region lives in a
 * shadow root. An author forces the fallback with `data-og-no-reconcile` — the only thing checked
 * here, on either document.
 */
export declare const NO_RECONCILE_SELECTOR = "[data-og-no-reconcile]";
export declare function reconcile_body(live: Element, next: Element, morph: (parent: Element, nodes: ArrayLike<Node>, options?: {
    stays?: (node: Node) => boolean;
}) => void): void;
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
export declare function swap_body(live: HTMLElement, next: HTMLElement): void;
