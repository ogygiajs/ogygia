import { relocate_trailing_empty_comments } from './lake-anchors.ts';
import { on_schedule } from '../contract/trigger.ts';
import { clock } from '@ogygia/machine';
import {
	FROZEN_SELECTOR,
	document_is_stored,
	is_awake,
	is_frozen,
	region_is_vacant,
	region_max_age_ms,
	region_on_expire,
	region_remount
} from './region-attrs.ts';
import { runtime_session } from './session.ts';
import { slots, type LakeArm, type LiftedLake } from './slots.ts';
import { warn } from '../messages/core.ts';
import { OG_LAKE, OG_STATIC } from '../wire-markup.ts';
import { note_lake_restore } from './rules.ts';

// the runtime's rules (./rules.ts): dev, and a build made with OGYGIA_RULES=1; folds out elsewhere
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

/** Feature entry: fill the `lakes` slot so core lifts/restores frozen regions. */
export function install(): void {
	slots.lakes = {
		on_frozen_connect,
		wait_for_boundary,
		lift,
		restore,
		settle_in,
		mark_frozen_settled,
		after_html_swap,
		after_fetch_exhausted
	};
}

export function settle_in(root: ParentNode): void {
	runtime_session.settle_lakes_in(root);
}

// A lake inside a LIVE snippet belongs to the snippet's own hydrate, which runs after the host's (its
// entry imports) and adopts the lake element as it stands (Region.svelte `lake_adopt`). The host's
// hydrate never walks into the snippet (it adopts the snippet element), so lifting the lake there only
// moved its trailing anchors in front of its content, and the snippet's hydrate then mismatched.
const in_live_snippet = (lake: Element, parent: Element) => {
	const snippet = lake.parentElement?.closest('ogygia-snippet');
	return !!snippet && parent.contains(snippet) && !snippet.hasAttribute(OG_STATIC);
};

/** The lakes `parent`'s own hydrate lifts and restores: nearest region is `parent`, outside live snippets. */
const lifted_lakes_of = (parent: Element) =>
	[...parent.querySelectorAll(FROZEN_SELECTOR)].filter(
		(l) => l.parentElement?.closest('ogygia-region') === parent && !in_live_snippet(l, parent)
	);

const lake_identity_of = (lake: Element) =>
	lake.getAttribute(OG_LAKE) || lake.getAttribute('entry') || '';

function lake_key(lake: Element): string {
	const identity = lake_identity_of(lake);
	if (!identity) return '';
	let rank = 0;
	for (const other of lake.ownerDocument.querySelectorAll(FROZEN_SELECTOR)) {
		if (other === lake) break;
		if (lake_identity_of(other) === identity) rank++;
	}
	return rank ? `${identity}#${rank}` : identity;
}

export function lift(parent: Element): LiftedLake[] {
	const lifted: LiftedLake[] = [];
	for (const lake of lifted_lakes_of(parent)) {
		const id = lake_key(lake);
		const frag = document.createDocumentFragment();
		while (lake.firstChild) frag.appendChild(lake.firstChild);
		relocate_trailing_empty_comments(frag, lake);
		lifted.push({
			id,
			frag,
			endpoint: lake.getAttribute('endpoint') || '',
			when: lake.getAttribute('when') || 'load',
			maxAgeMs: region_max_age_ms(lake)
		});
	}
	return lifted;
}

export function restore(parent: Element, lifted: LiftedLake[]): void {
	const by_key = new Map(lifted.map((l) => [l.id, l]));
	const pairs: Array<[Element, LiftedLake]> = [];
	for (const lake of lifted_lakes_of(parent)) {
		const own = by_key.get(lake_key(lake));
		if (own) pairs.push([lake, own]);
	}
	if (RULES) note_lake_restore(parent, lifted.length, pairs.length);
	// a live snippet's lakes stayed in place: settled and remembered here all the same, as the host is awake
	for (const lake of parent.querySelectorAll(FROZEN_SELECTOR)) {
		if (lake.parentElement?.closest('ogygia-region') !== parent || !in_live_snippet(lake, parent))
			continue;
		const id = lake_key(lake);
		settle_in(lake);
		runtime_session.initialized_lakes.add(id);
		remember(lake, id, {
			endpoint: lake.getAttribute('endpoint') || '',
			when: lake.getAttribute('when') || 'load',
			maxAgeMs: region_max_age_ms(lake)
		});
		// not moved, so nothing reconnects: re-enter the regions that waited on this lake
		for (const r of lake.querySelectorAll('ogygia-region'))
			(r as HTMLElement & { connectedCallback?(): void }).connectedCallback?.();
	}
	for (const [lake, { id, frag, endpoint, when, maxAgeMs }] of pairs) {
		settle_in(lake);
		settle_in(frag);
		runtime_session.initialized_lakes.add(id);
		lake.appendChild(frag);
		if (endpoint && !lake.getAttribute('endpoint')) lake.setAttribute('endpoint', endpoint);
		remember(lake, id, { endpoint, when, maxAgeMs });
	}
}

/** A lake with no AWAKE region host: nothing will ever lift/restore it (that is a host island's
 *  hydrate), so it settles itself and remembers itself. The shapes: a lake ADOPTED under Kit
 *  hydration (csr=true page), a lake inside an inline (Kit-hydrated) island, a top-level lake. */
function unhosted(el: Element): boolean {
	const host = el.parentElement?.closest('ogygia-region');
	return !host || !is_awake(host);
}

/**
 * Snapshot a lake's current children into the session cache — the copy a later VACANT connect of
 * the same lake id repaints from (`remount="cache"` / `"swr"`). First snapshot wins: the SSR HTML
 * (or the freshest revalidation, which replaces it in `after_html_swap`).
 */
function remember(
	lake: Element,
	id: string,
	meta: { endpoint: string; when: string; maxAgeMs: number }
) {
	const policy = region_remount(lake);
	if (!((policy === 'cache' || policy === 'swr') && id && !runtime_session.lake_cache.has(id)))
		return;
	const cached = document.createDocumentFragment();
	for (const child of Array.from(lake.childNodes)) {
		cached.appendChild(child.cloneNode(true));
	}
	runtime_session.lake_cache.set(id, {
		frag: cached,
		endpoint: meta.endpoint,
		when: meta.when,
		cachedAt: clock.mono(),
		maxAgeMs: meta.maxAgeMs || region_max_age_ms(lake)
	});
}

export function on_frozen_connect(el: HTMLElement, arm: LakeArm): boolean {
	if (!is_frozen(el)) return false;
	const id = lake_key(el);
	if (!runtime_session.initialized_lakes.has(id)) {
		// FIRST mount. On a normal document the SSR DOM is fresh — nothing to do. On a document
		// SERVED FROM A PAGE STORE (postrender) it is a cached render by definition, so an swr lake
		// treats this exactly like a stale remount: paint what's there, then revalidate on its
		// schedule — a fresh SERVER render carrying the visitor's cookies. This is how a stored
		// page's `render: 'live'` regions self-freshen (internal/notes/freeze.md).
		if (region_remount(el) === 'swr' && el.getAttribute('endpoint') && document_is_stored()) {
			on_schedule(el.getAttribute('when') || 'load', arm, () => arm.fetch_revalidate());
		} else if (
			import.meta.env.DEV &&
			region_remount(el) === 'swr' &&
			!el.parentElement?.closest('ogygia-region')
		) {
			// A live region with NO island host: nothing ever drives its remount revalidation on a
			// regular page (it works on store-served documents via the doc marker, and inside an
			// island host via lift/restore + remount). Say so instead of silently baking forever.
			warn('live_region_no_host', { id: el.getAttribute('entry') || id });
		}
		// A lake with no AWAKE region host is settled as it stands: nothing will ever lift/restore
		// it (that is the host island's hydrate), so the regions authored inside must self-run now
		// instead of waiting on `wait_for_boundary`. The shapes: a lake ADOPTED under Kit hydration
		// (csr=true page — the wrapper keeps the SSR element as opaque DOM, so its islands are ours),
		// and a lake inside an inline (Kit-hydrated) island. A lake inside a real island keeps
		// waiting: that island's hydrate lifts, restores and settles it.
		if (unhosted(el)) {
			runtime_session.settle_lake(el);
			// Such a lake is also the one nobody else can bring back. Under Kit hydration the wrapper
			// adopts the SSR element — until Kit gives up on the document (a component threw or the
			// markup mismatched: Svelte discards the server DOM and mounts fresh), and then the wrapper
			// renders the lake's element EMPTY (a lake is server HTML; the client has none) — a site
			// header vanishing on a client-on page, found on a customer deploy. So remember the SSR
			// children now and mark the id initialized: a later vacant connect of the same lake takes
			// the remount path below and repaints from this copy, its own regions reconnecting with it.
			if (!region_is_vacant(el)) {
				remember(el, id, {
					endpoint: el.getAttribute('endpoint') || '',
					when: el.getAttribute('when') || 'load',
					maxAgeMs: region_max_age_ms(el)
				});
				runtime_session.initialized_lakes.add(id);
			}
		}
		return true;
	}
	if (!region_is_vacant(el)) {
		if (unhosted(el)) runtime_session.settle_lake(el);
		return true;
	}
	const policy = region_remount(el);
	switch (policy) {
		case 'empty':
			runtime_session.settle_lake(el);
			return true;
		case 'cache':
		case 'swr': {
			const cached = runtime_session.lake_cache.peek(id);
			if (!cached) {
				runtime_session.settle_lake(el);
				return true;
			}
			const max_age = region_max_age_ms(el) || cached.maxAgeMs || 0;
			const expired = max_age > 0 && clock.mono() - cached.cachedAt > max_age;
			const on_expire = region_on_expire(el);

			if (expired && on_expire === 'empty') {
				runtime_session.settle_lake(el);
				return true;
			}

			if (expired && on_expire === 'fetch') {
				if (!cached.endpoint) {
					runtime_session.settle_lake(el);
					return true;
				}
				el.setAttribute('endpoint', cached.endpoint);
				const when = el.getAttribute('when') || cached.when || 'load';
				on_schedule(when, arm, () => arm.fetch_revalidate());
				return true;
			}

			if (policy === 'cache') {
				runtime_session.settle_lake(el);
				el.appendChild(cached.frag.cloneNode(true));
				return true;
			}
			el.appendChild(cached.frag.cloneNode(true));
			if (!cached.endpoint) {
				runtime_session.settle_lake(el);
				arm.wake_children();
				if (import.meta.env.DEV) {
					warn('live_region_no_endpoint', { id: el.getAttribute('entry') || id });
				}
				return true;
			}
			el.setAttribute('endpoint', cached.endpoint);
			const when = el.getAttribute('when') || cached.when || 'load';
			on_schedule(when, arm, () => arm.fetch_revalidate());
			return true;
		}
		default: {
			const _exhaustive: never = policy;
			return _exhaustive;
		}
	}
}

/**
 * A region authored in an unsettled lake waits on it (session.ts `LAKE`: `waited`). The lake's
 * settling wakes the ones that waited, on every path it settles by: a refresh that MORPHS its
 * children in place reconnects none of them (a vacant swr remount's cached copy, refreshed), so
 * nothing else would.
 */
export function wait_for_boundary(_el: HTMLElement, boundary: Element | null): boolean {
	return !!boundary && is_frozen(boundary) && runtime_session.wait_on_lake(boundary);
}

export function mark_frozen_settled(region: HTMLElement): void {
	if (is_frozen(region)) runtime_session.settle_lake_before_swap(region);
}

export function after_html_swap(
	region: HTMLElement,
	opts: { revalidate?: boolean },
	wake_children: () => void
): void {
	if (!is_frozen(region)) return;
	// (settled before the swap — mark_frozen_settled: what the swap brought in connected self-running;
	// what it morphed in place is woken here)
	if (runtime_session.wake_lake(region)) wake_children();
	if (!opts.revalidate) return;
	const id = lake_key(region);
	if (!id) return;
	const cached = document.createDocumentFragment();
	for (const child of Array.from(region.childNodes)) {
		cached.appendChild(child.cloneNode(true));
	}
	const prev = runtime_session.lake_cache.peek(id);
	runtime_session.lake_cache.set(id, {
		frag: cached,
		endpoint: region.getAttribute('endpoint') || prev?.endpoint || '',
		when: region.getAttribute('when') || prev?.when || 'load',
		cachedAt: clock.mono(),
		maxAgeMs: region_max_age_ms(region) || prev?.maxAgeMs || 0
	});
}

export function after_fetch_exhausted(
	region: HTMLElement,
	opts: { revalidate?: boolean },
	wake_children: () => void
): void {
	if (opts.revalidate && is_frozen(region) && region.isConnected) {
		runtime_session.settle_lake(region);
		wake_children();
	}
}
