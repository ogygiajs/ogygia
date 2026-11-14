import { hydrate, unmount, type Component } from 'svelte';
import { set_current_region, set_foreign_hydrate } from '../current-region.ts';
import { capture_region_ids } from './region-ids.ts';
import { nested_context } from '../nested.ts';
import type { PushableProps } from './pushable-props.svelte.ts';
import { foreign_region_prop_revivers } from './foreign-props.ts';
import { SEED_REF_KEY, seed_ref_reviver } from '../seed-ref-reviver.ts';
import { parse_sidecar_text } from './wire-format.ts';
import { is_deferred, ours_on_kit_document, region_ssr_truncated } from './region-attrs.ts';
import { boot_link, slots, type HeldLake } from './slots.ts';
import { report_thrown } from '../report-thrown.ts';
import type { HeadMark } from './session.ts';
import { install_hydrate_features } from 'ogygia:boot';
import { emit as dt_emit } from '../events/bus.ts';
import { warn } from '../messages/lazy.ts';
import { OG_FP, OG_HEALED, OG_RECOVERED, OGYGIA_KEEP } from '../wire-markup.ts';
import { say } from '@ogygia/machine';
import { ANCHOR, BLOCK_CLOSE, BLOCK_OPEN, FIRST_BRANCH_OPEN } from './svelte-markers.ts';

export const seed_page_once = (): void => slots.page?.seed_page_once();
export const seed_remote_once = (): void => slots.remoteSeeds?.seed_once();
export const kit_page_thread = (signal: AbortSignal): Promise<unknown> | null =>
	slots.page?.kit_page_thread(signal) ?? null;

install_hydrate_features();

const kit_hydrates_page = () => boot_link().kit_hydrates_page();
const props_sidecar_of = (region: Element) => boot_link().props_sidecar_of(region);
const parse_own_html = (html: string) =>
	boot_link().parse_region_html(boot_link().vouch_page_html(html));
const set_own_inner_html = (el: Element, html: string) =>
	boot_link().set_inner_html(el, boot_link().vouch_page_html(html));
const walk_enters = (el: Element) => boot_link().walk_enters(el);
const is_self_owned = (el: Element) => boot_link().is_self_owned(el);

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const HOOK_REGION_MISMATCHED =
	typeof __OGYGIA_HOOK_REGION_MISMATCHED__ !== 'undefined'
		? __OGYGIA_HOOK_REGION_MISMATCHED__
		: true;

const REPAIR_MORPH = { target: 'walk' } as const;

/** A hydrated island as the element holds it: how to tear it down, and (keep / live hosts) how to
 *  push the next page's props into it. */
export type IslandHandle = {
	dispose(): void;
	set_props?: (props: Record<string, unknown>) => void;
};

/** An island's loaded module: the component, plus a foreign build's own hydrate contract.
 *  `options.recover === false` asks the entry's svelte to THROW on a hydration mismatch instead
 *  of silently re-rendering (the self-heal below needs to know); an older entry ignores it. */
export type IslandModule = {
	default: Component<Record<string, unknown>>;
	__og_hydrate?: (
		target: Element,
		props: Record<string, unknown>,
		options?: { recover?: boolean }
	) => unknown;
	__og_unmount?: (app: unknown) => void;
};

function ensure_envelope(region: Element): void {
	if (has_envelope(region)) return;
	const first = region.firstChild;
	const last = region.lastChild;
	if (
		first &&
		last &&
		first !== last &&
		is_comment(first, FIRST_BRANCH_OPEN) &&
		is_comment(first.nextSibling, BLOCK_OPEN) &&
		is_comment(last, BLOCK_CLOSE)
	) {
		first.remove();
		last.remove();
		return;
	}
	region.insertBefore(document.createComment(BLOCK_OPEN), region.firstChild);
	region.appendChild(document.createComment(BLOCK_CLOSE));
}
function is_comment(node: Node | null, data: string): boolean {
	return !!node && node.nodeType === 8 && (node as Comment).data === data;
}
function has_envelope(region: Element): boolean {
	const first = region.firstChild;
	return !!first && first.nodeType === 8 && (first as Comment).data === BLOCK_OPEN;
}

let head_markers_neutralized = false;

/**
 * MAKE `<svelte:head>` HYDRATION SAFE on a csr=false document, before any island's head effect runs.
 * The caller runs this once per document (see the `head_markers_neutralized` guard at its call site).
 *
 * Svelte renders a component's `<svelte:head>` into `document.head`, not into the component's own
 * DOM, and delimits each block there as `<!--HASH-->` …content… `<!---->` (svelte/internal/server
 * `head()`). Its CLIENT `head(HASH, …)` hydrates by scanning document.head for the comment whose data
 * is HASH, then walking the nodes right after it as that block's content. That contract holds for a
 * whole-page hydrate (csr=true — Kit owns it, and this function never runs), but an ogygia island
 * hydrates in ISOLATION while that scan still reads the ONE shared document.head. By island-wake time
 * a third party has usually mutated the head (a design-system/monitoring inject, a hoisted sheet); a
 * foreign node landing in a block's range desyncs the walk into `set_attribute()` on a non-element,
 * which throws and discards the ENTIRE island (it never wakes). Note ogygia already keeps its OWN
 * head writes off this range by inserting region sheets at the head TOP (core.ts) — this closes the
 * same hole for head writes ogygia does not control.
 *
 * The fix is Svelte's own documented fallback: when `head()` finds no matching HASH marker it flips
 * out of hydration mode and RE-RENDERS the block fresh (svelte-head.js, `head_anchor === null`).
 * Removing the open markers up front takes every island's head down that safe path instead of the
 * fragile walk. The SSR-rendered head ELEMENTS stay (correct, already applied — sheets loaded, title
 * set) until the island's own live copy exists; then the island owns its head content and the
 * page's copy is retired (runtime/session.ts — who owns each node in <head>, and the one-copy rule).
 *
 * A head block is `<!--HASH-->` …content… `<!---->` — the HASH open and the empty close both sit at
 * the head's TOP LEVEL, while the content in between may carry Svelte's own block anchors when the head
 * is looped or branched: `{#if}`/`{#each}`/`{:else}` emit `<!--[-->` / `<!--[!-->` / `<!--[?-->` opens
 * and `<!--]-->` closes (svelte constants HYDRATION_START… and HYDRATION_END). So the open markers are found
 * by walking head's DIRECT children while tracking bracket depth: a comment whose data starts with `[`
 * is a block open (depth+1), `]` is a block close (depth−1), and at depth 0 a non-bracket, non-empty
 * comment is a head-block HASH open — confirmed when a depth-0 empty `<!---->` later closes its block.
 * That confirmation is what tells a real head marker from a lone third-party head comment (which has no
 * depth-0 empty close), so only genuine markers are removed; page/layout head blocks keep every rendered
 * element (their inert markers go), and element children are never descended into.
 */
export function neutralize_head_hydration_markers(): void {
	const head = typeof document !== 'undefined' ? document.head : null;
	if (!head) return;
	let depth = 0;
	let pending_open: Comment | null = null;
	const to_remove: Comment[] = [];
	for (let n = head.firstChild; n; n = n.nextSibling) {
		if (n.nodeType !== 8) continue;
		const data = (n as Comment).data;
		if (data[0] === BLOCK_OPEN) {
			depth++;
			continue;
		}
		if (data === BLOCK_CLOSE) {
			if (depth > 0) depth--;
			continue;
		}
		if (depth !== 0) continue;
		if (data === ANCHOR) {
			if (pending_open) {
				to_remove.push(pending_open);
				pending_open = null;
			}
		} else {
			pending_open = n as Comment;
		}
	}
	for (const m of to_remove) m.remove();
}

function repair_markup(region: HTMLElement, want: Element): void {
	if (align_to(region, want)) return;
	const nodes = Array.from(want.childNodes);
	const morph = slots.morph;
	if (morph) morph(region, nodes, REPAIR_MORPH);
	else region.replaceChildren(...nodes);
}

/**
 * Does the live node SEQUENCE differ from the server's? Exactly what Svelte's walk reads: node
 * types, element tags, text and comment data, recursively — never attributes (a custom element
 * upgrading adds `tabindex`, `aria-*`, ids; the walk does not care, and neither does this).
 *
 * Asked BEFORE the first hydrate attempt, not after a failed one: Svelte's walk does not verify
 * tags, so on a shifted sequence it writes attributes onto whatever node sits at its cursor —
 * measured on a customer deploy, the login trigger's `id`/`class`/`text` landed on the dropdown's
 * wrapper `<div>` — and only throws further down. A repair that came after would put the text
 * nodes back and leave those attributes on the wrong elements (an unstyled dropdown). Repairing
 * first, the walk never runs on the edited sequence.
 */
export function sequence_differs(live: Node, want: Node): boolean {
	const a = live.childNodes;
	const b = want.childNodes;
	if (a.length !== b.length) return true;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (x.nodeType !== y.nodeType) return true;
		if (x.nodeType === 1) {
			if ((x as Element).tagName !== (y as Element).tagName) return true;
			if (walk_enters(x as Element) && sequence_differs(x, y)) return true;
		} else if (x.nodeValue !== y.nodeValue) return true;
	}
	return false;
}

function has_non_ws(s: string | null): boolean {
	if (!s) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c !== 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) return true;
	}
	return false;
}

function node_label(n: Node): string {
	if (n.nodeType === 1) return `<${(n as Element).tagName.toLowerCase()}>`;
	if (n.nodeType === 3) return has_non_ws(n.nodeValue) ? 'a text node' : 'whitespace';
	if (n.nodeType === 8) return 'a comment';
	return 'a node';
}

function culprit_hint(n: Node): string {
	if (n.nodeType !== 1) return '';
	const el = n as Element;
	const tag = el.tagName.toLowerCase();
	if (tag === 'style')
		return ' — an injected <style> (scoped CSS from a component/design-system runtime)';
	if (tag === 'template' && el.hasAttribute('shadowrootmode'))
		return ' — a declarative shadow-DOM template injected after SSR';
	for (const a of el.attributes)
		if (a.name.startsWith('sc-') || a.name === 's-id' || a.name === 'c-id' || a.name === 's-sn')
			return ' — scoped web-component hydration marks (sc-*, s-id, c-id) a component runtime stamped over the island';
	if (el.classList.contains('hydrated')) return ' — a web-component runtime marked it `hydrated`';
	return '';
}

function describe_divergence(live: Node, want: Node, where = 'the island'): string | null {
	const a = live.childNodes;
	const b = want.childNodes;
	if (a.length !== b.length) {
		const longer = a.length > b.length ? a : b;
		const shorter = a.length > b.length ? b : a;
		let i = 0;
		while (
			i < shorter.length &&
			longer[i].nodeType === shorter[i].nodeType &&
			(longer[i].nodeType !== 1 ||
				(longer[i] as Element).tagName === (shorter[i] as Element).tagName)
		)
			i++;
		const node = longer[i] ?? longer[longer.length - 1];
		if (a.length > b.length)
			return `${a.length - b.length} node(s) were inserted into ${where} — e.g. ${node_label(node)}${culprit_hint(node)}`;
		const ws = node.nodeType === 3 && !has_non_ws(node.nodeValue);
		return `${b.length - a.length} node(s) the server sent were removed from ${where} — e.g. ${node_label(node)}${ws ? ' (whitespace stripped by a DOM-normalizing pass)' : ''}`;
	}
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (
			x.nodeType !== y.nodeType ||
			(x.nodeType === 1 && (x as Element).tagName !== (y as Element).tagName)
		)
			return `${where}: the server sent ${node_label(y)} but the browser had ${node_label(x)}${culprit_hint(x)}`;
		if (x.nodeType === 1) {
			if (!walk_enters(x as Element)) continue;
			const deeper = describe_divergence(x, y, node_label(x));
			if (deeper) return deeper;
		} else if (x.nodeValue !== y.nodeValue) {
			return `${where}: the text of ${node_label(y)} changed (a translator or text rewrite)`;
		}
	}
	return null;
}

let conflict: string | null = null;
function note_conflict(el: Element): void {
	conflict ??= node_label(el);
}

/** Put the island's light DOM back to the server's node sequence when it drifted while the island
 *  slept. Returns whether a repair was made and, in DEV / devtools, WHY it drifted (the first
 *  divergence, named before the repair rewrites the sequence). Called with the island's lakes LIFTED
 *  (lakes.ts): a lake's content is never part of the walk, and it may legitimately differ from the
 *  server copy by now (a live lake refreshes itself to the visitor before its host wakes) — so the
 *  copy's direct lakes are emptied the same way before the comparison, and the repair never touches
 *  them. */
export function repair_if_drifted(
	region: HTMLElement,
	ssr_html: string
): { repaired: boolean; reason: string | null; conflict: string | null } {
	const content = parse_own_html(ssr_html);
	const want = content.ownerDocument.createElement('ogygia-region');
	want.appendChild(content);
	if (!sequence_differs(region, want)) return { repaired: false, reason: null, conflict: null };
	const reason =
		import.meta.env.DEV || DEVTOOLS || (HOOK_REGION_MISMATCHED && slots.hooks?.regionMismatched)
			? describe_divergence(region, want)
			: null;
	conflict = null;
	repair_markup(region, want);
	const met = conflict;
	conflict = null;
	return { repaired: true, reason, conflict: met };
}

function align_to(live: Element, want: Element | DocumentFragment): boolean {
	const live_elements = element_children(live);
	const want_elements = element_children(want);
	if (live_elements.length !== want_elements.length) return false;
	for (let i = 0; i < live_elements.length; i++) {
		if (live_elements[i].tagName !== want_elements[i].tagName) return false;
	}
	for (let i = 0; i < live_elements.length; i++) {
		const child = live_elements[i];
		if (!walk_enters(child)) continue;
		if (!align_to(child, want_elements[i])) {
			if (is_self_owned(child)) note_conflict(child);
			const morph = slots.morph;
			if (morph) morph(child, Array.from(want_elements[i].childNodes), REPAIR_MORPH);
			else set_own_inner_html(child, (want_elements[i] as Element).innerHTML);
		}
	}
	for (const node of Array.from(live.childNodes)) if (node.nodeType !== 1) node.remove();
	let next = 0;
	for (const node of Array.from(want.childNodes)) {
		if (node.nodeType === 1) {
			next++;
			continue;
		}
		const before = live_elements[next] ?? null;
		live.insertBefore(node.cloneNode(true), before);
	}
	return true;
}

function element_children(node: Node): Element[] {
	const out: Element[] = [];
	for (const child of node.childNodes) if (child.nodeType === 1) out.push(child as Element);
	return out;
}

const SVELTE_FAILED_TO_HYDRATE = 'Failed to hydrate';
function quietly<T>(fn: () => T): T {
	const warn = console.warn;
	console.warn = (...args: unknown[]) => {
		if (typeof args[0] === 'string' && args[0].startsWith(SVELTE_FAILED_TO_HYDRATE)) return;
		warn.apply(console, args);
	};
	try {
		return fn();
	} finally {
		console.warn = warn;
	}
}

/** Is this entry another build's (fragment federation): absolute, different origin. */
export function is_foreign_entry(entry: string): boolean {
	return boot_link().ABSOLUTE_URL_SCHEME.test(entry) && new URL(entry).origin !== location.origin;
}

let cached_wire: (typeof slots)['wire'] | undefined;
let cached_revivers: Record<string, (d: never) => unknown> | undefined;
function region_prop_revivers(): Record<string, (d: never) => unknown> | undefined {
	const wire = slots.wire;
	if (wire === cached_wire) return cached_revivers;
	cached_wire = wire;
	cached_revivers = wire
		? { [wire.REF_WIRE_KEY]: (d: never) => wire.resolve(d, true) }
		: {
				OgygiaRef: () => {
					throw new Error(
						'wired prop but no wire feature in this build — ogygia detection bug, please report'
					);
				}
			};
	return cached_revivers;
}

/** A KEPT region reads the props of its incoming twin (`next`, the new page's copy): the ids they
 *  resolve are the kept region's from now on (R3 ownership), so its removal on a later navigation
 *  disposes them. `sidecar` is the twin's props sidecar, found while the twin was in its document. */
export function absorb_region_props(
	region: Element,
	sidecar: HTMLScriptElement | null
): Record<string, unknown> {
	return capture_region_ids(region, () => read_region_props(region, false, sidecar));
}

/**
 * Parse a region's `<script data-ogygia-props>` sidecar (keyed at the end of the body, or adjacent —
 * runtime/sidecar.ts). Uses the client reviver (`remember: true`) so a named/shared transportable
 * reunites with its live instance. Returns `{}` when there is no props sidecar.
 */
export function read_region_props(
	region: Element,
	foreign = false,
	sidecar: HTMLScriptElement | null = props_sidecar_of(region)
): Record<string, unknown> {
	if (!sidecar) return {};
	const base = foreign ? foreign_region_prop_revivers() : region_prop_revivers();
	const doc = sidecar.ownerDocument;
	const page = slots.page;
	const revivers =
		foreign || !page
			? base
			: { ...base, [SEED_REF_KEY]: seed_ref_reviver(() => page.seed_data_of(doc)) };
	return parse_sidecar_text(sidecar, revivers) as Record<string, unknown>;
}

class PropMutationGuard {
	readonly #warned = say();

	#warn(entry: string, prop_path: string) {
		this.#warned.once(`${entry}${prop_path}`, () =>
			warn('prop_mutation', { prop: prop_path, entry })
		);
	}

	#guard_map(map: Map<unknown, unknown>, entry: string, prop_path: string) {
		const mutators = new Set(['set', 'delete', 'clear']);
		return new Proxy(map, {
			get: (target, prop) => {
				const value = Reflect.get(target, prop);
				if (typeof value !== 'function') return value;
				if (typeof prop === 'string' && mutators.has(prop)) {
					return (...args: unknown[]) => {
						this.#warn(entry, `${prop_path}.${prop}()`);
						return (value as (...a: unknown[]) => unknown).apply(target, args);
					};
				}
				return (value as (...a: unknown[]) => unknown).bind(target);
			}
		});
	}

	#guard_set(set: Set<unknown>, entry: string, prop_path: string) {
		const mutators = new Set(['add', 'delete', 'clear']);
		return new Proxy(set, {
			get: (target, prop) => {
				const value = Reflect.get(target, prop);
				if (typeof value !== 'function') return value;
				if (typeof prop === 'string' && mutators.has(prop)) {
					return (...args: unknown[]) => {
						this.#warn(entry, `${prop_path}.${prop}()`);
						return (value as (...a: unknown[]) => unknown).apply(target, args);
					};
				}
				return (value as (...a: unknown[]) => unknown).bind(target);
			}
		});
	}

	#guard_value(value: unknown, entry: string, prop_path: string): unknown {
		if (value === null || typeof value !== 'object') return value;
		if (value instanceof Map)
			return this.#guard_map(value as Map<unknown, unknown>, entry, prop_path);
		if (value instanceof Set) return this.#guard_set(value as Set<unknown>, entry, prop_path);
		const proto = Object.getPrototypeOf(value);
		if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value;
		return new Proxy(value as Record<string | symbol, unknown>, {
			get: (target, prop, receiver) => {
				const child = Reflect.get(target, prop, receiver);
				if (typeof prop === 'symbol') return child;
				return this.#guard_value(
					child,
					entry,
					prop_path ? `${prop_path}.${String(prop)}` : String(prop)
				);
			},
			set: (target, prop, next, receiver) => {
				if (typeof prop !== 'symbol') {
					this.#warn(entry, prop_path ? `${prop_path}.${String(prop)}` : String(prop));
				}
				return Reflect.set(target, prop, next, receiver);
			},
			deleteProperty: (target, prop) => {
				if (typeof prop !== 'symbol') {
					this.#warn(entry, prop_path ? `${prop_path}.${String(prop)}` : String(prop));
				}
				return Reflect.deleteProperty(target, prop);
			},
			defineProperty: (target, prop, descriptor) => {
				if (typeof prop !== 'symbol') {
					this.#warn(entry, prop_path ? `${prop_path}.${String(prop)}` : String(prop));
				}
				return Reflect.defineProperty(target, prop, descriptor);
			}
		});
	}

	wrap(props: Record<string, unknown>, entry: string): Record<string, unknown> {
		return this.#guard_value(props, entry, '') as Record<string, unknown>;
	}
}

const dev_guard = import.meta.env?.DEV ? new PropMutationGuard() : null;
const prop_guard = {
	wrap: (props: Record<string, unknown>, entry: string): Record<string, unknown> =>
		dev_guard ? dev_guard.wrap(props, entry) : props
};

// oxlint-disable-next-line ogygia/no-silent-failures -- unmount's promise is its outros ending; it never rejects
const unmount_app = (app: unknown) => void unmount(app as Record<string, unknown>);

function handle(
	app: unknown,
	dispose_with: (app: unknown) => void,
	entry: string,
	pushed: PushableProps | null
): IslandHandle {
	const h: IslandHandle = {
		dispose() {
			try {
				dispose_with(app);
			} catch (error) {
				report_thrown(error);
			}
		}
	};
	if (pushed) h.set_props = (props) => pushed.push(prop_guard.wrap(props, entry));
	return h;
}

/**
 * THE island hydrate step — synchronous from here on (the element already awaited the module and
 * its scheduler turn): seeds, props, envelope, `hydrate()` through the provider, lake restore,
 * the mutation detector. Returns the handle, or `null` when the island is not ours to hydrate (a
 * Kit-hydrated page — marked `data-kit-hydrated`). Throws on a failed hydrate; the element reports.
 */
export function hydrate_island(
	region: HTMLElement,
	entry: string,
	mod: IslandModule,
	ssr_html: string | null = null,
	touched = true
): IslandHandle | null {
	seed_remote_once();
	seed_page_once();
	const Component = mod.default;

	const foreign = is_foreign_entry(entry);

	const props = capture_region_ids(region, () => read_region_props(region, foreign));

	if (kit_hydrates_page() && !ours_on_kit_document(region)) {
		region.setAttribute('data-kit-hydrated', '');
		if (import.meta.env.DEV) {
			warn('island_on_kit_page', { entry });
		}
		return null;
	}

	if (!kit_hydrates_page() && !head_markers_neutralized) {
		head_markers_neutralized = true;
		neutralize_head_hydration_markers();
	}

	if (import.meta.env.DEV && !is_deferred(region) && region_ssr_truncated(region)) {
		warn('island_block_in_inline', { entry });
	}

	let head_mark: HeadMark | null = null;
	let held: HeldLake[] | null = slots.lakes.hold(region);
	const drift =
		ssr_html !== null && touched && region.isConnected
			? repair_if_drifted(region, ssr_html)
			: { repaired: false, reason: null, conflict: null };
	const repaired = drift.repaired;
	try {
		head_mark = kit_hydrates_page() ? null : boot_link().runtime_session.mark_head();
		if (!region.isConnected) return null;
		const ssr_children = Array.from(region.children);

		const foreign_delegate = foreign && typeof mod.__og_hydrate === 'function';

		const wrapped = foreign ? props : prop_guard.wrap(props, entry);
		const keep = region.hasAttribute(OGYGIA_KEEP) && !!slots.Pushable;
		if (keep && import.meta.env.DEV && !document.querySelector('meta[name="ogygia-router"]')) {
			warn('keep_without_router', { entry, key: region.getAttribute(OGYGIA_KEEP) || '' });
		}

		const attempt = (recover: boolean): IslandHandle => {
			if (!is_deferred(region) && !foreign_delegate) ensure_envelope(region);
			set_current_region(region);
			try {
				if (foreign_delegate) {
					set_foreign_hydrate({ origin: new URL(entry).origin, entry });
					const app = mod.__og_hydrate!(region, wrapped, recover ? undefined : { recover: false });
					return handle(app, mod.__og_unmount ?? (() => {}), entry, null);
				}
				const provided_ctx = capture_region_ids(region, () => slots.context?.(region));
				const recovery = recover ? {} : { recover: false as const };
				const pushed = keep ? new slots.Pushable!(wrapped) : null;
				const app = hydrate(Component, {
					target: region,
					props: pushed ? pushed.props : wrapped,
					context: nested_context(provided_ctx, region),
					...recovery
				});
				return handle(app, unmount_app, entry, pushed);
			} finally {
				set_current_region(null);
				set_foreign_hydrate(null);
			}
		};

		let out: IslandHandle;
		let healed = false;
		let strict_error: unknown = null;
		const after_hydrate = boot_link().region_hydrate(region);
		try {
			out = quietly(() => attempt(false));
			healed = repaired;
		} catch (err) {
			strict_error = err;
			out = attempt(true);
		}
		after_hydrate?.();
		if (healed) {
			region.setAttribute(OG_HEALED, drift.reason || '');
			if (DEVTOOLS)
				dt_emit({
					domain: 'runtime',
					name: 'region.hydrate.healed',
					entry,
					fp: region.getAttribute(OG_FP) || undefined,
					reason: drift.reason || undefined
				});
			if (HOOK_REGION_MISMATCHED)
				slots.hooks?.regionMismatched?.({
					el: region,
					kind: 'healed',
					...(drift.reason ? { reason: drift.reason } : {})
				});
			if (import.meta.env.DEV) warn('island_healed', { entry, drift: drift.reason });
		}
		if (drift.conflict) {
			if (DEVTOOLS)
				dt_emit({
					domain: 'runtime',
					name: 'region.hydrate.conflict',
					entry,
					fp: region.getAttribute(OG_FP) || undefined,
					reason: drift.conflict
				});
			if (HOOK_REGION_MISMATCHED)
				slots.hooks?.regionMismatched?.({ el: region, kind: 'conflict', reason: drift.conflict });
			if (import.meta.env.DEV) warn('ownership_conflict', { element: drift.conflict }, entry);
		}

		slots.lakes.release(region, held);
		held = null;

		if (!region.isConnected) {
			out.dispose();
			return null;
		}

		if (ssr_children.length > 0 && !ssr_children.some((el) => region.contains(el))) {
			region.setAttribute(OG_RECOVERED, drift.reason || '');
			if (DEVTOOLS)
				dt_emit({
					domain: 'runtime',
					name: 'region.hydrate.recovered',
					entry,
					fp: region.getAttribute(OG_FP) || undefined,
					reason: drift.reason || undefined
				});
			if (HOOK_REGION_MISMATCHED)
				slots.hooks?.regionMismatched?.({
					el: region,
					kind: 'recovered',
					...(drift.reason ? { reason: drift.reason } : {})
				});
			warn('hydration_discarded', {
				entry,
				drift: drift.reason,
				strict:
					strict_error === null
						? null
						: strict_error instanceof Error
							? strict_error.message
							: String(strict_error)
			});
		}

		if (head_mark) boot_link().runtime_session.record_island_head(head_mark);
		return out;
	} finally {
		head_mark?.stop();
		if (held) slots.lakes.release(region, held);
	}
}

/**
 * Hydrate a live region's swapped-in HTML with pushable props, so a later tick reaches the mounted
 * island in place. Its HTML is svelte `render()`'s (the root anchor pair already there) — the
 * deferred swap's shape, so it is never wrapped again. `null` when the live feature is absent.
 */
export function hydrate_live(
	region: HTMLElement,
	entry: string,
	mod: IslandModule,
	props: Record<string, unknown>
): IslandHandle | null {
	seed_remote_once();
	seed_page_once();
	if (!slots.Pushable) {
		if (import.meta.env.DEV) {
			warn('live_feature_missing');
		}
		return null;
	}
	const provided_ctx = capture_region_ids(region, () => slots.context?.(region));
	const after_hydrate = boot_link().region_hydrate(region);
	const pushed = new slots.Pushable(prop_guard.wrap(props, entry));
	set_current_region(region);
	let app: unknown;
	try {
		app = hydrate(mod.default, {
			target: region,
			props: pushed.props,
			context: nested_context(provided_ctx, region)
		});
	} finally {
		set_current_region(null);
	}
	after_hydrate?.();
	return handle(app, unmount_app, entry, pushed);
}
