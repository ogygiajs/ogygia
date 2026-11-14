import { slots } from './slots.ts';
import type { PageGlobals, PendingShadow } from '../page-globals.ts';
import {
	attributes_writer,
	is_declared_foreign,
	is_region_owned,
	is_self_owned,
	mark_render_made,
	order_owner,
	owner_of,
	render_made,
	REGION_RENDER_ATTRS,
	slots_light_dom
} from './ownership.ts';

// @why the DOM's node constants by value, not `Node.*`: no DOM at import (test: test/morph-no-dom.test.ts › the morph loads under plain node with no DOM)
const ELEMENT = 1;
const TEXT = 3;
const COMMENT = 8;
const FOLLOWING = 4;

/** Feature entry: fill the `morph` slot (live static-region ticks morph in place), and the
 *  `sync_attributes` slot the navigation's body reconcile syncs attributes with. */
export function install(): void {
	slots.morph = morph_children;
	slots.sync_attributes = sync_attributes;
}

/**
 * Reconcile `parent`'s children toward `new_nodes` (a freshly parsed, detached region) IN PLACE:
 * a node that can be reused keeps its identity, so focus, selection, scroll, typed form state and
 * running transitions survive (ideas from micromorph and idiomorph, with real keyed matching).
 * `new_nodes` is read, never changed: an array or a live `NodeList` fits.
 *
 * - **Lockstep** first: old and new children walk together while they agree (the same key; or both
 *   key-less, the same tag, and holding the same keys inside). The rest goes to the keyed pass.
 * - **Keyed hit**: a new node's key (`data-key`, else `id`) finds the old node wherever it sits; it
 *   moves into place and morphs.
 * - **Id-set hit** (wrapper matching): a key-less wrapper is matched by the keys inside it. The old
 *   sibling of the same tag holding them moves into place, so a banner added or removed above an
 *   island's wrapper does not re-mount the island; an old wrapper a later new sibling wants is not
 *   taken by an earlier one.
 * - **Positional hit**: a key-less node of the same kind and tag morphs in place. **Miss**: a fresh
 *   copy goes in. What no new node claimed is removed.
 * - One node: text and comments take the new value; another tag is replaced; the same tag syncs its
 *   form properties, then its attributes ({@link sync_attributes}), then its children.
 * - **Form state follows the server only when the server changed its mind**: `value` moves only when
 *   the new node carries a `value` attribute that differs from the previous render's; `checked` and
 *   `selected` only when the attribute's presence flipped. The focused control is never touched.
 * - **Not entered**: a declared-foreign element (`data-ogygia-keep`, `data-persist`) and a hydrated
 *   or kept region are matched and kept as they are. An upgraded custom element's host attributes
 *   are its runtime's. Its children match by identity, not position: what it made itself stays, a render node the answer no longer has goes, and under one that slots its
 *   light DOM the render's nodes end in the answer's order and the render's leftover block markers go.
 * - The root is vetted like any descendant: a declared-foreign root is left alone, and toward
 *   Svelte's walk (`target: 'walk'`) only a root the walk reads, or a region root (the island being
 *   repaired), is entered.
 * - After the morph, `aria-hidden="true"` is taken off the focused element's ancestors up to the
 *   root, never above it: the browser blocks an aria-hidden ancestor of focus.
 * - A copy of a host keeps its open shadow root (a declarative one the parse attached, a restored
 *   one): its children, its adopted sheets, and the sheets still waiting for the restorer. The
 *   caller gives the inserted roots the page's registry (html-sink.ts `init_shadow_registries`).
 */
export function morph_children(
	parent: Element,
	new_nodes: ArrayLike<Node>,
	options?: MorphOptions
): void {
	const walk = options?.target === 'walk';
	if (is_declared_foreign(parent)) return;
	if (walk) {
		const owner = owner_of(parent);
		if (owner !== 'walk' && owner !== 'region') return;
	}
	reconcile(parent, new_nodes, build_id_sets(parent, new_nodes), walk, options?.stays);
	clear_aria_hidden_over_focus(parent);
}

/**
 * One ownership rule (runtime/ownership.ts), two TARGETS.
 *
 * - **`live`** (default: a hole re-answer, a router body swap, a live region tick) — the target is the
 *   new answer, and the DOM stays live afterwards: a child an upgraded element gave itself is foreign
 *   content, kept (a web component must not lose its own upgrade work).
 * - **`walk`** (the pre-hydration repair) — the target is the server sequence Svelte's walk binds by
 *   position, exactly. The same foreign child sitting in a position the walk reads is the node
 *   Svelte's cursor trips on (`getAttribute is not a function` on a nested web component's own
 *   residue), so here it is removed; and a subtree the walk never enters (`data-og-opaque`, a slot) is
 *   left alone — nothing reads it.
 *
 * In both targets a declared-foreign element and a hydrated region are matched, never entered, and an
 * upgraded element's host ATTRIBUTES stay its runtime's.
 */
export interface MorphOptions {
	target?: 'live' | 'walk';
	/**
	 * A child of the ROOT that is not the render's (the router's body reconcile: a node a script put
	 * in `<body>`, such as a portal's mount anchor; ownership.ts `server_body_child`). The morph steps
	 * over it: never matched, never moved, never removed. The render's children around it reconcile
	 * as usual. Root level only; below the root the ownership rules decide.
	 */
	stays?: (node: Node) => boolean;
}

function clear_aria_hidden_over_focus(parent: Element): void {
	const doc = owner_document(parent);
	const active = doc.activeElement;
	if (active == null || active === doc.body || !parent.contains(active)) return;
	let n: Element | null = active;
	while (n) {
		if (n.getAttribute('aria-hidden') === 'true') n.removeAttribute('aria-hidden');
		if (n === parent) break;
		n = n.parentElement;
	}
}

type IdSets = WeakMap<Element, Set<string>> | null;

const KEYED_SELECTOR = '[data-key],[id]';

function build_id_sets(parent: Element, new_nodes: ArrayLike<Node>): IdSets {
	let sets: IdSets = null;
	const register = (key: string, start: Node | null, stop: Node | null): void => {
		for (let a = start; a !== null && a !== stop && a.nodeType === ELEMENT; a = a.parentNode) {
			let set = (sets ??= new WeakMap()).get(a as Element);
			if (set === undefined) sets.set(a as Element, (set = new Set()));
			set.add(key);
		}
	};
	for (const el of parent.querySelectorAll(KEYED_SELECTOR)) {
		const k = key_of(el);
		if (k !== null) register(k, el.parentNode, parent);
	}
	const count = new_nodes.length;
	for (let i = 0; i < count; i++) {
		const root = new_nodes[i];
		if (root.nodeType !== ELEMENT) continue;
		// @why a new root is a sibling candidate: its own set holds its descendants' keys (test: test/morph.test.ts › a banner inserted above a key-less wrapper keeps the keyed node inside it)
		for (const el of (root as Element).querySelectorAll(KEYED_SELECTOR)) {
			const k = key_of(el);
			if (k !== null) register(k, el.parentNode, root.parentNode);
		}
	}
	return sets;
}

function id_sets_agree(sets: NonNullable<IdSets>, a: Node, b: Node): boolean {
	if (a.nodeType !== ELEMENT) return true;
	const sa = sets.get(a as Element);
	const sb = sets.get(b as Element);
	if (sa === undefined) return sb === undefined;
	if (sb === undefined) return false;
	return intersects(sa, sb);
}

function intersects(a: Set<string>, b: Set<string>): boolean {
	if (a.size > b.size) [a, b] = [b, a];
	for (const k of a) if (b.has(k)) return true;
	return false;
}

function find_holder(
	old_inner: Map<string, Element>,
	wanted: Set<string>,
	next: Node
): Element | null {
	for (const key of wanted) {
		const holder = old_inner.get(key);
		if (holder !== undefined && same_node(holder, next)) return holder;
	}
	return null;
}

function release_holder(
	old_inner: Map<string, Element>,
	sets: NonNullable<IdSets>,
	el: Element
): void {
	const held = sets.get(el);
	if (held === undefined) return;
	for (const key of held) if (old_inner.get(key) === el) old_inner.delete(key);
}

function reserved_for_later(
	sets: NonNullable<IdSets>,
	new_inner: Map<string, number> | null,
	cursor: ChildNode,
	idx: number
): boolean {
	if (new_inner === null) return false;
	const held = sets.get(cursor as Element);
	if (held === undefined) return false;
	for (const key of held) {
		const wanter = new_inner.get(key);
		if (wanter !== undefined && wanter > idx) return true;
	}
	return false;
}

function reconcile(
	parent: Element,
	new_nodes: ArrayLike<Node>,
	sets: IdSets,
	walk: boolean,
	stays?: (node: Node) => boolean
): void {
	if (!walk && order_owner(parent) === 'element') reconcile_by_identity(parent, new_nodes, sets);
	else reconcile_children(parent, new_nodes, sets, walk, stays);
}

function reconcile_children(
	parent: Element,
	new_nodes: ArrayLike<Node>,
	sets: IdSets,
	walk = false,
	stays?: (node: Node) => boolean
): void {
	const count = new_nodes.length;
	const step = (n: ChildNode | null): ChildNode | null => {
		if (stays) while (n && stays(n)) n = n.nextSibling;
		return n;
	};
	let cursor: ChildNode | null = step(parent.firstChild);
	let idx = 0;

	while (idx < count && cursor) {
		const next = new_nodes[idx];
		const ck = key_of(cursor);
		const nk = key_of(next);
		if (ck !== nk) break;
		if (nk === null) {
			if (!same_node(cursor, next)) break;
			if (sets !== null && !id_sets_agree(sets, cursor, next)) break;
			const here = cursor;
			cursor = step(cursor.nextSibling);
			morph_same(here, next, sets, walk);
		} else {
			const here = cursor;
			cursor = step(cursor.nextSibling);
			morph_node(here, next, sets, walk);
		}
		idx++;
	}

	if (idx >= count) {
		while (cursor) {
			const gone = cursor;
			cursor = step(cursor.nextSibling);
			parent.removeChild(gone);
		}
		return;
	}
	if (cursor === null) {
		for (; idx < count; idx++) parent.insertBefore(clone(new_nodes[idx]), null);
		return;
	}

	let old_keys: Map<string, ChildNode> | null = null;
	let old_inner: Map<string, Element> | null = null;
	for (let n: ChildNode | null = cursor; n; n = step(n.nextSibling)) {
		const k = key_of(n);
		if (k !== null) {
			(old_keys ??= new Map()).set(k, n);
		} else if (sets !== null && n.nodeType === ELEMENT) {
			const held = sets.get(n as Element);
			if (held !== undefined) {
				old_inner ??= new Map();
				for (const key of held) if (!old_inner.has(key)) old_inner.set(key, n as Element);
			}
		}
	}
	let new_inner: Map<string, number> | null = null;
	if (old_inner !== null) {
		for (let i = idx; i < count; i++) {
			const n = new_nodes[i];
			if (n.nodeType !== ELEMENT || key_of(n) !== null) continue;
			const wanted = sets!.get(n as Element);
			if (wanted === undefined) continue;
			new_inner ??= new Map();
			for (const key of wanted) if (!new_inner.has(key)) new_inner.set(key, i);
		}
	}

	if (old_keys === null && old_inner === null) {
		for (; idx < count; idx++) {
			const next = new_nodes[idx];
			if (cursor && key_of(next) === null && same_node(cursor, next)) {
				const here = cursor;
				cursor = step(cursor.nextSibling);
				morph_same(here, next, sets, walk);
			} else {
				parent.insertBefore(clone(next), cursor);
			}
		}
	} else {
		for (; idx < count; idx++) {
			const next = new_nodes[idx];
			const next_key = key_of(next);

			if (next_key !== null) {
				const matched = old_keys?.get(next_key);
				if (matched !== undefined) {
					old_keys!.delete(next_key);
					if (matched === cursor) {
						cursor = step(cursor.nextSibling);
					} else {
						parent.insertBefore(matched, cursor);
					}
					morph_node(matched, next, sets, walk);
					continue;
				}
			} else if (old_inner !== null && next.nodeType === ELEMENT) {
				const wanted = sets!.get(next as Element);
				const holder = wanted === undefined ? null : find_holder(old_inner, wanted, next);
				if (holder !== null) {
					release_holder(old_inner, sets!, holder);
					if (holder === cursor) {
						cursor = step(cursor.nextSibling);
					} else {
						parent.insertBefore(holder, cursor);
					}
					morph_same(holder, next, sets, walk);
					continue;
				}
			}

			let cur_key: string | null = null;
			while (cursor) {
				cur_key = key_of(cursor);
				if (cur_key === null || old_keys === null || !old_keys.has(cur_key)) break;
				cursor = step(cursor.nextSibling);
			}

			if (
				cursor &&
				next_key === null &&
				cur_key === null &&
				same_node(cursor, next) &&
				(old_inner === null || !reserved_for_later(sets!, new_inner, cursor, idx))
			) {
				const here = cursor;
				cursor = step(cursor.nextSibling);
				if (old_inner !== null) release_holder(old_inner, sets!, here as Element);
				morph_same(here, next, sets, walk);
				continue;
			}

			parent.insertBefore(clone(next), cursor);
		}
	}

	while (cursor) {
		const gone = cursor;
		cursor = step(cursor.nextSibling);
		parent.removeChild(gone);
	}
	if (old_keys) {
		for (const node of old_keys.values()) {
			if (node.parentNode === parent) parent.removeChild(node);
		}
	}
}

function reconcile_by_identity(parent: Element, new_nodes: ArrayLike<Node>, sets: IdSets): void {
	const count = new_nodes.length;
	const slotted = slots_light_dom(parent);
	const placed_in_order: ChildNode[] = [];
	const render_tags = new Set<string>();
	for (let i = 0; i < count; i++)
		if (new_nodes[i].nodeType === ELEMENT) render_tags.add((new_nodes[i] as Element).localName);

	let by_key: Map<string, ChildNode> | null = null;
	const by_tag = new Map<string, Element[]>();
	const others: ChildNode[] = [];
	let old_inner: Map<string, Element> | null = null;
	for (let n: ChildNode | null = parent.firstChild; n; n = n.nextSibling) {
		const k = key_of(n);
		if (k !== null) {
			(by_key ??= new Map()).set(k, n);
		} else if (n.nodeType === ELEMENT) {
			if (!render_made(n, render_tags)) continue;
			const el = n as Element;
			let list = by_tag.get(el.localName);
			if (!list) by_tag.set(el.localName, (list = []));
			list.push(el);
			const held = sets?.get(el);
			if (held !== undefined) {
				old_inner ??= new Map();
				for (const key of held) if (!old_inner.has(key)) old_inner.set(key, el);
			}
		} else others.push(n);
	}

	const claimed = new Set<Node>();
	let anchor: Node | null = null;
	let other_at = 0;
	for (let i = 0; i < count; i++) {
		const next = new_nodes[i];
		let match: ChildNode | null = null;
		if (next.nodeType === ELEMENT) {
			const k = key_of(next);
			if (k !== null) {
				const keyed = by_key?.get(k);
				if (keyed !== undefined) {
					by_key!.delete(k);
					match = keyed;
				}
			} else {
				const wanted = old_inner !== null ? sets!.get(next as Element) : undefined;
				const holder = wanted === undefined ? null : find_holder(old_inner!, wanted, next);
				if (holder !== null && !claimed.has(holder)) match = holder;
				else {
					const queue = by_tag.get((next as Element).localName);
					while (queue?.length && claimed.has(queue[0])) queue.shift();
					match = queue?.shift() ?? null;
				}
				if (match !== null && old_inner !== null)
					release_holder(old_inner, sets!, match as Element);
			}
		} else if (next.nodeType === COMMENT) {
			let first: ChildNode | null = null;
			for (let j = 0; j < others.length; j++) {
				const o = others[j];
				if (
					o.nodeType !== COMMENT ||
					claimed.has(o) ||
					(o as Comment).data !== (next as Comment).data
				)
					continue;
				if (!slotted || anchor === null || anchor.compareDocumentPosition(o) & FOLLOWING) {
					match = o;
					break;
				}
				first ??= o;
			}
			match ??= first;
		} else {
			while (
				other_at < others.length &&
				(others[other_at].nodeType !== next.nodeType || claimed.has(others[other_at]))
			)
				other_at++;
			if (other_at < others.length) match = others[other_at++];
		}
		if (match !== null && !claimed.has(match)) {
			claimed.add(match);
			const before = match.previousSibling;
			morph_node(match, next, sets, false);
			let placed = before ? before.nextSibling : parent.firstChild;
			if (match.parentNode === parent) placed = match;
			if (placed) {
				mark_render_made(placed);
				anchor = placed;
				placed_in_order.push(placed as ChildNode);
			}
			continue;
		}
		const copy = clone(next);
		parent.insertBefore(copy, anchor ? anchor.nextSibling : parent.firstChild);
		mark_render_made(copy);
		anchor = copy;
		placed_in_order.push(copy as ChildNode);
	}

	for (const list of by_tag.values())
		for (const el of list) if (!claimed.has(el) && el.parentNode === parent) parent.removeChild(el);
	if (by_key)
		for (const n of by_key.values())
			if (n.parentNode === parent && render_made(n, render_tags)) parent.removeChild(n);
	if (slotted) {
		for (const o of others)
			if (!claimed.has(o) && o.parentNode === parent && is_block_marker(o)) parent.removeChild(o);
		order_render_nodes(parent, placed_in_order);
	}
}

function is_block_marker(n: Node): boolean {
	if (n.nodeType !== COMMENT) return false;
	const d = (n as Comment).data;
	return d === '' || d === ']' || d.charCodeAt(0) === 91;
}

function order_render_nodes(parent: Element, nodes: ChildNode[]): void {
	const count = nodes.length;
	if (count < 2) return;
	const at = new Map<Node, number>();
	let index = 0;
	for (let n = parent.firstChild; n; n = n.nextSibling) at.set(n, index++);
	const tails: number[] = [];
	const prev = new Int32Array(count).fill(-1);
	for (let k = 0; k < count; k++) {
		const p = at.get(nodes[k])!;
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (at.get(nodes[tails[mid]])! < p) lo = mid + 1;
			else hi = mid;
		}
		if (lo > 0) prev[k] = tails[lo - 1];
		tails[lo] = k;
	}
	if (tails.length === count) return;
	const stay = new Uint8Array(count);
	for (let k = tails[tails.length - 1]; k >= 0; k = prev[k]) stay[k] = 1;
	let first_stay: ChildNode | null = null;
	for (let k = 0; k < count && first_stay === null; k++) if (stay[k]) first_stay = nodes[k];
	let last: ChildNode | null = null;
	for (let k = 0; k < count; k++) {
		const n = nodes[k];
		if (!stay[k]) {
			const ref: ChildNode | null = last ? last.nextSibling : first_stay;
			if (ref !== n) parent.insertBefore(n, ref);
		}
		last = n;
	}
}

function sync_render_attributes(from: Element, to: Element, walk: boolean): void {
	if (walk || from.localName !== to.localName) return;
	for (const name of REGION_RENDER_ATTRS) {
		const next = to.getAttribute(name);
		if (next !== null && next !== from.getAttribute(name)) from.setAttribute(name, next);
	}
}

function sync_by_writer(from: Element, to: Element, walk: boolean): void {
	const writer = attributes_writer(from);
	if (writer === 'render') sync_attributes(from, to, is_self_owned(from));
	else if (writer === 'region') sync_render_attributes(from, to, walk);
}

function key_of(node: Node): string | null {
	if (node.nodeType !== ELEMENT) return null;
	const el = node as Element;
	const dk = el.getAttribute('data-key');
	if (dk !== null) return dk;
	const id = el.id;
	return id !== '' ? id : null;
}

function same_node(a: Node, b: Node): boolean {
	if (a.nodeType !== b.nodeType) return false;
	if (a.nodeType === ELEMENT) {
		return (
			(a as Element).tagName === (b as Element).tagName &&
			(a as Element).namespaceURI === (b as Element).namespaceURI
		);
	}
	return true;
}

function off_limits(el: Element, walk: boolean): boolean {
	if (is_declared_foreign(el) || is_region_owned(el)) return true;
	return walk && owner_of(el) !== 'walk';
}

function morph_node(from: Node, to: Node, sets: IdSets, walk: boolean): void {
	const kind = from.nodeType;
	if (kind === TEXT || kind === COMMENT) {
		if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
		return;
	}
	if (kind !== ELEMENT) return;

	const ef = from as Element;
	const et = to as Element;

	// @why kept before the tag check: a keyed match whose tag changed never replaces a kept element (test: test/browser/dom-ownership.test.ts › morph: a keyed match whose tag changed never replaces a kept element)
	if (off_limits(ef, walk)) {
		if (attributes_writer(ef) === 'region') sync_render_attributes(ef, et, walk);
		return;
	}
	if (ef.tagName !== et.tagName || ef.namespaceURI !== et.namespaceURI) {
		ef.parentNode?.replaceChild(clone(to), ef);
		return;
	}
	sync_form_props(ef, et);
	sync_by_writer(ef, et, walk);
	reconcile(ef, et.childNodes, sets, walk);
}

function morph_same(from: Node, to: Node, sets: IdSets, walk: boolean): void {
	const kind = from.nodeType;
	if (kind === TEXT || kind === COMMENT) {
		if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
		return;
	}
	if (kind !== ELEMENT) return;
	const ef = from as Element;
	const et = to as Element;
	if (off_limits(ef, walk)) {
		if (attributes_writer(ef) === 'region') sync_render_attributes(ef, et, walk);
		return;
	}
	// @why form properties before attributes: the rule reads the previous render's attribute (test: test/morph.test.ts › a changed default DOES move an unfocused dirty value (server changed its mind))
	sync_form_props(ef, et);
	sync_by_writer(ef, et, walk);
	reconcile(ef, et.childNodes, sets, walk);
}

/** Add + update + remove attributes so `from` matches `to` exactly. Boolean attrs are attr presence.
 *  `keep_extra` (a self-owned element, {@link is_self_owned}): add + update only — an attribute the
 *  element gave itself is not the render's to take away. */
export function sync_attributes(from: Element, to: Element, keep_extra = false): void {
	const to_attrs = to.attributes;
	const to_len = to_attrs.length;
	for (let i = 0; i < to_len; i++) {
		const attr = to_attrs[i];
		if (from.getAttribute(attr.name) === attr.value) continue;
		if (attr.name === 'aria-hidden' && attr.value === 'true' && subtree_has_focus(from)) continue;
		from.setAttribute(attr.name, attr.value);
	}
	if (keep_extra) return;
	const from_attrs = from.attributes;
	if (from_attrs.length > to_len) {
		// @why backwards: a removal shifts the live attribute list (test: test/browser/morph-claims.test.ts › removes every attribute the new render dropped, side by side ones too)
		for (let i = from_attrs.length - 1; i >= 0; i--) {
			const name = from_attrs[i].name;
			if (!to.hasAttribute(name)) from.removeAttribute(name);
		}
	}
}

function sync_form_props(from: Element, to: Element): void {
	const tag = from.tagName;
	if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'OPTION') return;
	if (owner_document(from)?.activeElement === from) return;

	const ff = from as HTMLInputElement;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
		const next = to.getAttribute('value');
		if (next !== null && next !== from.getAttribute('value') && ff.value !== next) ff.value = next;
	}
	if (tag === 'INPUT') {
		const next = to.hasAttribute('checked');
		if (next !== from.hasAttribute('checked') && ff.checked !== next) ff.checked = next;
	}
	if (tag === 'OPTION') {
		const of = from as unknown as HTMLOptionElement;
		const next = to.hasAttribute('selected');
		if (next !== from.hasAttribute('selected') && of.selected !== next) of.selected = next;
	}
}

function clone(node: Node): Node {
	const copy = owner_document(node).importNode(node, true);
	if (node.nodeType === ELEMENT) carry_shadows_under(node as Element, copy as Element);
	return copy;
}

function carry_shadows_under(src: Element, dst: Element): void {
	const root = src.shadowRoot;
	if (root && root.mode === 'open' && !dst.shadowRoot) carry_shadows(root, dst);
	for (
		let s = src.firstElementChild, d = dst.firstElementChild;
		s && d;
		s = s.nextElementSibling, d = d.nextElementSibling
	)
		carry_shadows_under(s, d);
}

function carry_shadows(root: ShadowRoot, dst: Element): void {
	const copy = dst.attachShadow({ mode: 'open', delegatesFocus: root.delegatesFocus });
	for (const c of Array.from(root.childNodes)) copy.appendChild(clone(c));
	try {
		if (root.adoptedStyleSheets.length) copy.adoptedStyleSheets = [...root.adoptedStyleSheets];
	} catch {
		// ok: sheets made for another document; the restorer's pending list covers ours
	}
	const pending = (root as PendingShadow).__og_pending;
	if (pending) {
		(copy as PendingShadow).__og_pending = pending;
		const w = globalThis as PageGlobals;
		(w.__og_adopt ??= []).push({ shadow: copy, sheets: pending });
	}
}

function owner_document(node: Node): Document {
	return node.ownerDocument ?? document;
}

function subtree_has_focus(el: Element): boolean {
	const doc = owner_document(el);
	const active = doc.activeElement;
	return active != null && active !== doc.body && el.contains(active);
}
