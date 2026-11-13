import { dispose_ids, page_ids } from '../ref.ts';
import { boot_link, morph_sync_attributes, slots } from './slots.ts';
import { ids_released } from './region-ids.ts';
import { emit as dt_emit } from '../events/bus.ts';
import { OG_FP, OG_NO_RECONCILE, OGYGIA_KEEP } from '../wire-markup.ts';

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
import { fnv1a, endpoint_key, signature_of, fingerprint_of } from '../contract/hash.ts';
export { fnv1a, endpoint_key, signature_of, fingerprint_of };

const props_sidecar_of = (region: Element) => boot_link().props_sidecar_of(region);

function body_record(live: Element) {
	const link = slots.boot;
	return link && link.server_body_attributes(live) !== null ? link : null;
}

function sync_body_attributes(live: Element, next: Element): void {
	morph_sync_attributes()(live, next, true);
	const sent = body_record(live)?.server_body_attributes(live);
	if (sent) for (const name of sent) if (!next.hasAttribute(name)) live.removeAttribute(name);
}

function page_own_children(live: Element): Set<Node> {
	const own = new Set<Node>();
	const record = body_record(live);
	if (record === null) return own;
	for (let n = live.firstChild; n; n = n.nextSibling) if (!record.server_body_child(n)) own.add(n);
	return own;
}

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

const RECONCILE_KEY = 'data-key';

/** Stamp reconcile keys onto a root's regions + keep-chrome, without clobbering an authored key/id.
 *  A region's key is its identity (fingerprint, or signature for a persisted one) plus which copy of
 *  it it is; keep-chrome keys by keep name. */
export function stamp_region_keys(root: ParentNode): void {
	const regions = root.querySelectorAll('ogygia-region');
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
		const keep = el.getAttribute(OGYGIA_KEEP);
		if (keep !== null) {
			el.setAttribute(RECONCILE_KEY, `k\0${keep}`);
		} else if (el.hasAttribute('data-persist')) {
			stamp(el, `p\0${region_signature(el)}`);
		} else {
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

/** Did the author opt this page's body out of the in-place reconcile? On the body itself or any
 *  element in it (test/browser/no-reconcile-opt-out.test.ts). */
export function opts_out_of_reconcile(body: Element): boolean {
	return body.hasAttribute(OG_NO_RECONCILE) || body.querySelector(NO_RECONCILE_SELECTOR) !== null;
}

function dt_emit_reconcile(live: Element, next: Element): void {
	const key = (el: Element) => el.getAttribute('data-key') ?? '';
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
	const own = page_own_children(live);
	sync_body_attributes(live, next);
	if (DEVTOOLS) dt_emit_reconcile(live, next);
	const next_keys = new Set<string>();
	for (const el of next.querySelectorAll('ogygia-region')) {
		const k = el.getAttribute('data-key');
		if (k !== null) next_keys.add(k);
	}
	const departed: Element[] = [];
	for (const el of live.querySelectorAll('ogygia-region')) {
		const k = el.getAttribute('data-key');
		if (k !== null && next_keys.has(k)) continue;
		departed.push(el);
	}
	absorb_kept_props(live, next);
	morph(live, next.childNodes, own.size > 0 ? { stays: (n) => own.has(n) } : undefined);
	renew_server_body(live, next, own);
	release_page_ids(departed, live, next);
}

function release_page_ids(departed: readonly Element[], live: Element, next: Element): void {
	const released = ids_released(page_ids(), departed, live, next.ownerDocument);
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
	const before = Array.from(live.querySelectorAll('ogygia-region'));
	sync_body_attributes(live, next);
	if (own.size === 0) {
		live.replaceChildren();
	} else {
		for (let n = live.firstChild; n;) {
			const here = n;
			n = n.nextSibling;
			if (!own.has(here)) live.removeChild(here);
		}
	}
	while (next.firstChild) live.appendChild(next.firstChild);
	renew_server_body(live, next, own);
	release_page_ids(
		before.filter((el) => !live.contains(el)),
		live,
		next
	);
}

type Absorbable = Element & { absorbKeptProps?: (incoming: Element) => void };

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
