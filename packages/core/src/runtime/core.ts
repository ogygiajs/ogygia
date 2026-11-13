import {
	backoffAfter,
	buggify,
	clock,
	flights,
	registry,
	STALE,
	tasks,
	type Mailbox,
	type Scope,
	type Stale,
	type Turn
} from '@ogygia/machine';
import { frameAddress, older_by, stands_at, type FrameOrder } from '../frame.ts';
import { on_trigger, WAKE } from '../contract/trigger.ts';
import { OG_BAKED, OG_FP, OG_HOLE, OG_KEPT, OG_STATIC, OGYGIA_REGION_CSS } from '../wire-markup.ts';
import { import_again, is_failed_import, on_file_load, on_reload_needed } from './import-again.ts';
import { browser_offline, no_response } from './network.ts';
import { FRAMES } from 'ogygia:boot';
import { wire_for_wake } from './wire-on-use.ts';
import { report_thrown } from '../report-thrown.ts';
import { kit_hydrates_page } from './kit-boot.ts';
import {
	init_shadow_registries,
	parse_region_html,
	vouch_remote_answer,
	type VerifiedHtml
} from './html-sink.ts';
import { mark_region_changed, region_changed, watch_region } from './drift-watch.ts';
import { runtime_session } from './session.ts';
import {
	capability_expired,
	is_allowed_region_endpoint,
	island_module_url,
	RegionAnswerLater,
	RegionAnswerRefused
} from './region-endpoint-url.ts';
import { fetch_hole } from './hole-fetch.ts';
import { recover_from_stale_deps } from './stale-deps.ts';
import {
	island_entry_of,
	import_entry,
	on_entry_fallback,
	pin_build_map,
	pin_region_urls
} from './entry-locations.ts';
import { code_origins, code_url, import_code } from './code-origins.ts';
import { load_devalue, needs_devalue } from './devalue-lane.ts';
import {
	is_awake,
	is_deferred,
	is_frozen,
	ours_on_kit_document,
	phase2_hydrate_schedule,
	region_hydrate_schedule,
	region_schedule
} from './region-attrs.ts';
import { slots, type FrameOps } from './slots.ts';
import {
	create_answer,
	create_hole,
	busy_machines,
	create_live,
	create_paint,
	create_region_life,
	create_wake,
	detached,
	lifetime_of,
	new_lifetime,
	type Answer,
	type Hole,
	type Live,
	type Paint,
	type RegionLife,
	type RegionMachinesNow,
	type Wake
} from './region-machines.ts';
import { KEEP_FALLBACK_HTML } from '../keep-fallback-marker.ts';
import { download, region_fetch, region_rate_limited } from '../policies.ts';
import {
	install_rules,
	note_handed,
	note_left,
	note_mount,
	note_shown,
	note_turn,
	note_unbound,
	note_unmount
} from './rules.ts';
import { PAGE_FACTS_SELECTOR } from '../page-facts-script.ts';
import { link_boot } from './boot-link.ts';
import {
	background_start,
	hydrate_settled,
	hydrate_started,
	hydrate_turn,
	register_region,
	unregister_region,
	yield_task
} from './schedule.ts';
import { once_on_screen } from './viewport.ts';
import {
	note_code_sheets,
	sheet_of,
	use_code_sheets,
	use_sheets,
	type RegionSheet
} from './region-sheets.ts';
import { preload_island_graph } from './island-graph-preload.ts';
import { fetch_priority_of, LoadSlot, viewport_class, type LoadClass } from './load-scheduler.ts';
import { PRIORITY } from './load-class.ts';
import type { FrameFetcher } from './frame-store.ts';
import { connected_regions } from './connected.ts';
import { props_sidecar_of, restore_props_sidecar } from './sidecar.ts';
import { hole_facts_of } from './hole-facts.ts';
import { set_hydrating, tap_svelte_warnings, on_svelte_warning } from './svelte-warnings.ts';
import type { IslandHandle, IslandModule } from './hydrate-core.ts';
import { emit as dt_emit } from '../events/bus.ts';
import {
	install_window_sink as dt_install_window_sink,
	ingest_server_events as dt_ingest_server
} from '../events/sinks.ts';
import {
	CLIENT_PLUGINS,
	HOOK_ANSWER_PARSED,
	HOOK_ANSWER_PLACED,
	HOOK_ENTRY_FALLBACK,
	HOOK_HOLE_ANSWERED,
	HOOK_HOLE_FAILED,
	HOOK_REGION_FAILED,
	HOOK_REGION_HYDRATED,
	HOOK_REGION_MOUNT,
	HOOK_REGION_UNMOUNT,
	HOOK_REGION_WOKE,
	HOOK_WARNING,
	boot_client_plugins,
	client_region_mount
} from './client-plugins.ts';
import type { ClientRealm } from './client-plugins.ts';
import { OgygiaError, warn, line } from '../messages/core.ts';
import { disclose_version } from './disclose-version.ts';

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

const SSR_SNAPSHOT_MAX = 1 << 19;

const PRISTINE_SSR = Symbol('ogygia.pristine-ssr');
type PristineHost = { [PRISTINE_SSR]?: string };

const CSS_ASSET_HREF_RE = /\.css(\?|$)/;

function snapshot_markup(region: Element): string | null {
	if (!region.firstChild) return null;
	const html = region.innerHTML;
	return html.length > SSR_SNAPSHOT_MAX ? null : html;
}

function fragment_markup(frag: DocumentFragment): string | null {
	if (!frag.firstChild) return null;
	const box = document.createElement('div');
	box.appendChild(frag);
	const html = box.innerHTML;
	frag.append(...Array.from(box.childNodes));
	return html.length > SSR_SNAPSHOT_MAX ? null : html;
}

function dt_ids(el: Element): { entry?: string; fp?: string } {
	const entry = el.getAttribute('entry') || undefined;
	const fp = el.getAttribute(OG_FP) || undefined;
	return { entry, fp };
}

const now_ms = clock.mono;

type HydrateCore = typeof import('./hydrate-core.ts');
let loaded_core: HydrateCore | null = null;
const import_core = import_again(() => import('./hydrate-core.ts'));
const hydrate_core = flights({
	name: 'hydrate core',
	run: () =>
		yield_task()
			.then(import_core)
			.then((m) => (loaded_core = m)),
	retry: download
});

function absorb_page_facts_now(): void {
	if (runtime_session.visit.facts.length && loaded_core)
		// oxlint-disable-next-line ogygia/no-silent-failures -- devalue's download failed: the facts stay queued, and the next wake's load absorbs them (and says a failure)
		void load_devalue().then(
			() => loaded_core?.seed_page_once(),
			() => {}
		);
}

function devalue_for_wake(): Promise<unknown> | undefined {
	if (runtime_session.visit.facts.length || document_needs_devalue()) return load_devalue();
}

let doc_needs_devalue: boolean | null = null;
let devalue_swap_armed = false;
function document_needs_devalue(): boolean {
	if (doc_needs_devalue === null) {
		if (!devalue_swap_armed) {
			devalue_swap_armed = true;
			// oxlint-disable-next-line ogygia/owned-effects -- the devalue-lane answer's reset on each page swap, installed once (`devalue_swap_armed`): it lives as long as the document
			document.addEventListener('og:after-swap', devalue_lane_stale);
		}
		doc_needs_devalue = needs_devalue(document);
	}
	return doc_needs_devalue;
}

function devalue_lane_stale(): void {
	if (doc_needs_devalue === false) doc_needs_devalue = null;
}

const ON_DEMAND_EVENTS = [
	'pointerover',
	'focusin',
	'pointerdown',
	'touchstart',
	'keydown'
] as const;
const ON_DEMAND_SELECTOR = 'ogygia-region[render="defer"][when="interaction"]';
const NO_REPLAY: Promise<unknown> = Promise.resolve();

const on_demand_armed = registry.keyed<Element, () => void>();
let on_demand_installed = false;
function on_demand_event(e: Event): void {
	if (on_demand_armed.size === 0) return;
	let region = e.target instanceof Element ? e.target.closest(ON_DEMAND_SELECTOR) : null;
	while (region && !on_demand_armed.has(region)) {
		region = region.parentElement?.closest(ON_DEMAND_SELECTOR) ?? null;
	}
	if (!region) return;
	on_demand_armed.get(region)!();
}
function arm_on_demand(region: Element, fire: () => void, owner: Scope): void {
	const forget = on_demand_armed.set(
		region,
		() => {
			forget();
			fire();
		},
		owner
	);
	if (on_demand_installed) return;
	on_demand_installed = true;
	for (const type of ON_DEMAND_EVENTS)
		// oxlint-disable-next-line ogygia/owned-effects -- the on-demand delegation, installed once (`on_demand_installed`) for every armed hole: it lives as long as the document
		document.addEventListener(type, on_demand_event, { capture: true, passive: true });
}

const load_island = (entry: string, cls: LoadClass = 'visible') => {
	preload_island_graph(entry, undefined, fetch_priority_of(cls));
	return import_entry<IslandModule>(entry, island_module_url(entry));
};

function dom_ready() {
	if (typeof document === 'undefined' || document.readyState !== 'loading')
		return Promise.resolve();
	return new Promise((r) =>
		// oxlint-disable-next-line ogygia/owned-effects -- the document's own parse, once: it fires once and goes (`once`), whoever waited
		document.addEventListener('DOMContentLoaded', r, { once: true })
	);
}

type Leaves = { readonly scope: Scope };

type LiveTick = {
	id: string;
	module: string;
	props: Record<string, unknown>;
	html: string;
	url?: string;
	hydrate?: string;
	hydrateMargin?: string;
	written?: FrameOrder | undefined;
};

const hand_back = (release: () => void): void => release();

function say_island_failed(entry: string | null, err: unknown): void {
	if (kit_boot_failed(err)) {
	} else if (is_failed_import(err)) {
		if (import.meta.env.DEV) {
			console.error(new OgygiaError('island_load_failed_stale_deps', { entry }), err);
			// oxlint-disable-next-line ogygia/no-silent-failures -- dev only, never rejects (its failure leaves the error above)
			if (entry) void recover_from_stale_deps(island_module_url(entry));
		} else {
			console.error(new OgygiaError('island_load_failed', { entry }), err);
		}
	} else {
		console.error(new OgygiaError('island_hydrate_failed', { entry }), err);
	}
}
const nothing = (): void => {};
const kit_boot_failed = (err: unknown): boolean =>
	(err as { code?: unknown } | null)?.code === 'kit_boot_failed';

const SNIPPET_BOOTS = Symbol.for('ogygia.snippet-boots');
const SNIPPET_BOOT_CAP_MS = 10_000;

async function snippets_settled(region: Element, visit: Scope): Promise<void> {
	const host = region as Element & { [SNIPPET_BOOTS]?: Promise<unknown>[] };
	const wait = visit.child();
	const cap = new Promise<void>((r) => wait.defer(r));
	wait.timeout(() => wait.close(), SNIPPET_BOOT_CAP_MS);
	try {
		for (
			let batch = host[SNIPPET_BOOTS];
			batch?.length && !wait.closed;
			batch = host[SNIPPET_BOOTS]
		) {
			host[SNIPPET_BOOTS] = [];
			await Promise.race([Promise.allSettled(batch), cap]);
			await Promise.resolve(); // (their effects, and the snippets they render, register)
		}
	} finally {
		wait.close();
		delete host[SNIPPET_BOOTS];
	}
}

/**
 * Parse a fetched region's HTML into a fragment, HOISTING any `<link data-ogygia-region-css>` (or
 * inlined `<style data-ogygia-region-css="href">`) it carries into `<head>` (deduped by href). A held / server-picked region's component was never
 * imported by the page, so its scoped CSS is in no stylesheet the page loaded; the region response
 * ships the links and the runtime lifts them to the head — where they load once and stick. (A link
 * left in the body would also fail to load inside a `<template>` batch parcel.) `sheets`: the head
 * nodes the answer uses, for the region that paints it (./region-sheets.ts `use_sheets`).
 */
export function region_fragment(html: VerifiedHtml): {
	frag: DocumentFragment;
	ready: Promise<void>;
	sheets: readonly Element[];
} {
	const frag = parse_region_html(html);
	devalue_lane_stale();
	const { facts: queued, scope: page } = runtime_session.visit;
	for (const facts of frag.querySelectorAll(PAGE_FACTS_SELECTOR)) {
		facts.remove();
		queued.push(facts.textContent ?? '');
	}
	const links = frag.querySelectorAll(`link[${OGYGIA_REGION_CSS}]`);
	const pending: Array<Promise<void>> = [];
	const sheets: Element[] = [];
	if (links.length && import.meta.env.DEV) {
		const seen = new Set<string>();
		for (const link of links) {
			const href = link.getAttribute('href');
			link.remove();
			if (!href) continue;
			const url = code_url(island_module_url(href));
			if (url === null || seen.has(url)) continue;
			seen.add(url);
			pending.push(
				// oxlint-disable-next-line ogygia/no-silent-failures -- a stylesheet wait only: the swap goes on, and the region's own import says a failure
				import_code(url).then(
					() => undefined,
					() => undefined
				)
			);
		}
	} else if (links.length) {
		const existing = new Map(
			Array.from(document.querySelectorAll('link[rel="stylesheet"]'), (l) => [
				l.getAttribute('href'),
				l as HTMLLinkElement
			])
		);
		const until_settled = (sheet: RegionSheet) => sheet.wait('loaded').then(() => undefined);
		for (const link of links) {
			const href = link.getAttribute('href');
			link.remove();
			if (!href) continue;
			const present = existing.get(href);
			if (present) {
				const sheet = sheet_of(present);
				if (sheet.now.kind === 'loading') pending.push(until_settled(sheet));
				if (sheet.now.kind !== 'failed') {
					sheets.push(present);
					continue;
				}
				present.remove();
			}
			const clone = document.createElement('link');
			clone.rel = 'stylesheet';
			clone.href = href;
			clone.setAttribute(OGYGIA_REGION_CSS, '');
			pending.push(until_settled(sheet_of(clone)));
			existing.set(href, clone);
			sheets.push(clone);
			runtime_session.claim_page_head(clone);
			document.head.appendChild(clone);
		}
	}
	const styles = frag.querySelectorAll(`style[${OGYGIA_REGION_CSS}]`);
	if (styles.length) {
		const present = new Map<string, Element>();
		for (const n of document.head.querySelectorAll(
			`[${OGYGIA_REGION_CSS}], link[rel="stylesheet"]`
		)) {
			const id = n.tagName === 'STYLE' ? n.getAttribute(OGYGIA_REGION_CSS) : n.getAttribute('href');
			if (id) present.set(id, n);
		}
		for (const style of styles) {
			const id = style.getAttribute(OGYGIA_REGION_CSS) || '';
			style.remove();
			if (!id) continue;
			const found = present.get(id);
			if (found !== undefined) {
				sheets.push(found);
				continue;
			}
			const el = document.createElement('style');
			present.set(id, el);
			sheets.push(el);
			el.setAttribute(OGYGIA_REGION_CSS, id);
			el.textContent = style.textContent || '';
			runtime_session.claim_page_head(el);
			document.head.insertBefore(el, document.head.firstChild);
		}
	}
	const ready = pending.length
		? page
				.task(
					() =>
						new Promise<void>((resolve) => {
							const cancel = page.timeout(resolve, 5000);
							// oxlint-disable-next-line ogygia/no-silent-failures -- every pending wait above resolves, failed or not
							void Promise.all(pending).then(() => {
								cancel();
								resolve();
							});
						})
				)
				.then(() => undefined)
		: Promise.resolve();
	if (HOOK_ANSWER_PARSED) slots.hooks?.answerParsed?.({ fragment: frag });
	for (const el of frag.querySelectorAll('ogygia-region')) {
		if (el.getAttribute('entry') && !is_deferred(el) && !is_frozen(el)) {
			(el as unknown as PristineHost)[PRISTINE_SSR] = el.innerHTML;
		}
	}

	return { frag, ready, sheets };
}

/** TEST: the pristine server markup {@link region_fragment} stashed on a nested island, if any. */
export function pristine_ssr_of(el: Element): string | undefined {
	return (el as unknown as PristineHost)[PRISTINE_SSR];
}

class OgygiaRegion extends HTMLElement {
	#region: RegionLife = create_region_life();
	#minted_endpoint: string | null = null;
	#ssr_html: string | null = null;
	get #life(): Scope {
		return this.#region.now.life;
	}
	get #box(): Mailbox {
		return this.#region.now.box;
	}
	#shown: VerifiedHtml | null = null;
	#live_last: LiveTick | null = null;
	#asleep: Scope | null = null;
	get #watching(): boolean {
		return this.#asleep !== null && !this.#asleep.closed;
	}
	#watch(): void {
		if (this.#watching) return;
		watch_region((this.#asleep = this.#life.child()), this);
	}
	#unwatch(): void {
		this.#asleep?.close();
		this.#asleep = null;
	}
	#hole: Hole = create_hole();
	#answer: Answer = create_answer();
	#wake: Wake = create_wake();
	#fetch_started = 0;
	#frame_address: string | null = null;
	#binding: Scope | null = null;
	#visitor: Promise<unknown> | null = null;
	#app: IslandHandle | null = null;
	#live_ready = false;
	#live: Live = create_live();
	#paint: Paint = create_paint();
	#live_painted: FrameOrder | null = null;
	#hydrate_run: { visit: unknown; run: Promise<void> } | null = null;
	#fire_hydrate = (): Promise<void> => {
		const held = this.#hydrate_run;
		if (held && (held.visit === this.#wake.now || this.#wake.now.kind === 'waking'))
			return held.run;
		const run = this.#box.ask((turn) => this.#hydrate(turn)).then(nothing);
		const entry = { visit: this.#wake.now, run };
		this.#hydrate_run = entry;
		const ran = () => this.#hydrate_ran(entry);
		run.then(ran, ran);
		return run;
	};
	#hydrate_ran(entry: { visit: unknown; run: Promise<void> }): void {
		if (this.#hydrate_run === entry) this.#hydrate_run = null;
	}
	#fire_server = () => this.#box.post((turn) => this.#server(turn));
	#fire_prefetch = () => this.#box.post(() => this.#prefetch_html());

	absorbKeptProps(next: Element): void {
		if (!this.#app?.set_props || !loaded_core) return;
		const sidecar = props_sidecar_of(next);
		const codec = wire_for_wake(next);
		this.#absorbing?.close();
		this.#absorbing = null;
		if (codec === undefined) return this.#absorb(sidecar);
		const waiting = (this.#absorbing = this.#life.child());
		waiting
			.task(() => codec)
			.then((loaded) => {
				if (loaded !== STALE) this.#absorb(sidecar);
			}, report_thrown);
	}
	#absorbing: Scope | null = null;
	#absorb(sidecar: HTMLScriptElement | null): void {
		if (!this.#app?.set_props || !loaded_core) return;
		try {
			this.#app.set_props(loaded_core.absorb_region_props(this, sidecar));
			// oxlint-disable-next-line ogygia/no-silent-failures -- malformed incoming props: the live props it has are kept
		} catch {}
	}

	connectedCallback() {
		// its lifetime in the page starts, and its mailbox with it (a move, or a connect called again,
		// keeps the ones it has; a connect called on an element out of the page starts none)
		if (this.isConnected && this.#region.now.kind === 'detached') {
			this.#region.go('connected', new_lifetime());
			// the navigation's shadow-root check counts these (connected.ts): once per lifetime, held by it
			connected_regions.add(this, this.#life);
		}
		devalue_lane_stale();
		// its relative URLs, against the address it entered at — they are read again after any
		// navigation, when `location` is another page (entry-locations.ts)
		pin_region_urls(this);
		this.#box.post((turn) => this.#connect(turn));
	}

	#connect(turn: Turn): Promise<void> | undefined {
		if (this.hasAttribute('live')) return this.#live_put_back(turn);
		if (FRAMES && this.#minted_endpoint === null && is_deferred(this)) {
			const minted = this.getAttribute('endpoint');
			if (minted) this.#minted_endpoint = minted;
			else {
				const identity = this.getAttribute(OG_HOLE);
				const facts = identity ? hole_facts_of(this.ownerDocument, identity) : null;
				if (facts) {
					this.setAttribute('endpoint', facts.endpoint);
					// (written by the server relative to this page, as the SSR element's was: pinned the same)
					pin_region_urls(this);
					this.#minted_endpoint = this.getAttribute('endpoint');
					if (facts.sidecar)
						restore_props_sidecar(this, facts.sidecar.cloneNode(true) as HTMLScriptElement);
				} else if (import.meta.env.DEV && identity) {
					warn('hole_without_address', { region: this.getAttribute('entry') || identity });
				}
			}
		}
		if (is_frozen(this) && slots.lakes.on_frozen_connect(this, this.#lake_arm())) return;
		if (this.#region.now.kind === 'scheduled') return;
		const boundary = this.parentElement && this.parentElement.closest('ogygia-region');
		const slot =
			this.parentElement && this.parentElement.closest(`ogygia-slot,ogygia-snippet[${OG_STATIC}]`);
		const in_adopted_slot = !!(boundary && slot && boundary.contains(slot));
		const entry_attr = this.getAttribute('entry') || '';
		const foreign_entry =
			entry_attr.indexOf(':') > 0 &&
			/^[a-z][a-z0-9+.-]*:/i.test(entry_attr) &&
			new URL(entry_attr).origin !== location.origin;
		if (
			boundary &&
			is_awake(boundary) &&
			!is_deferred(this) &&
			!in_adopted_slot &&
			!foreign_entry
		) {
			this.setAttribute('data-nested', '');
			if (DEVTOOLS)
				dt_emit({
					domain: 'runtime',
					name: 'region.connected',
					...dt_ids(this),
					wake: this.getAttribute('wake') || undefined,
					deferred: false,
					nested: true
				});
			if (import.meta.env.DEV) {
				warn('nested_region_rides_parent', {
					entry: this.getAttribute('entry') || '',
					wake: this.getAttribute('wake') || 'load'
				});
			}
			return;
		}
		const deferred = is_deferred(this);
		// Keep the server markup a self-running island connected with (see #ssr_html) — at the FIRST
		// connect, before anything else about the schedule: an island inside a lake still waiting on
		// its boundary reconnects later, and by then another script may have edited it. The runtime
		// is the first script in `<head>` (server/head-presence.ts `runtime_first`), so this copy is
		// the parsed document as the server sent it. A hole's copy is taken from its answer instead.
		// Prefer the PRISTINE markup captured from the fetched fragment (region_fragment) over a live
		// snapshot: inside a just-swapped hole a foreign runtime may already have upgraded a custom element
		// here, so the live DOM is no longer the server's bytes. A top-level island (no stash) snapshots
		// live as before — there the runtime connected before anything else could touch it.
		if (!deferred && this.#ssr_html === null) {
			const pristine = (this as unknown as PristineHost)[PRISTINE_SSR];
			this.#ssr_html = pristine ?? snapshot_markup(this);
			// (a pristine copy predates this connect: the live DOM may already differ, so it compares)
			if (pristine != null) mark_region_changed(this);
		}
		if (this.#ssr_html !== null) this.#watch();
		if (!deferred && slots.lakes.wait_for_boundary(this, boundary)) return;
		this.#region.move('connected', 'scheduled', lifetime_of(this.#region.now));
		// A hole that had its answer, put back on the page: its schedule is spent (#336)
		if (deferred && this.#answer.now.kind !== 'none') {
			this.#put_back();
			return;
		}
		const when = region_schedule(this);
		if (DEVTOOLS) {
			dt_emit({
				domain: 'runtime',
				name: 'region.connected',
				...dt_ids(this),
				wake: this.getAttribute('wake') || undefined,
				deferred,
				nested: false
			});
			dt_emit({ domain: 'runtime', name: 'wake.scheduled', ...dt_ids(this), when });
		}
		if (!deferred) register_region(this, this.#life);
		if (!deferred) {
			if (this.#wake.now.kind === 'cold') this.#wake.go('armed');
			this.#arm(when, this.#fire_hydrate);
			return;
		}
		if (!this.#hole_armed()) return;
		this.#arm(when, this.#fire_server);
		// a hand-written `prefetch` the compiler would refuse (`interaction`, or `when`'s own) arms nothing
		const prefetch = this.getAttribute('prefetch');
		if (prefetch && prefetch !== when && prefetch !== 'interaction') {
			this.#arm(prefetch, this.#fire_prefetch);
		}
	}

	#hole_armed(): boolean {
		const s = this.#hole.now;
		if (s.kind === 'armed') return true;
		if (s.kind === 'fetching') return false;
		return this.#hole.go('armed', { attempts: s.kind === 'retrying' ? s.attempts : 0 });
	}

	/**
	 * A hole that had its answer is back on the page (#336): it binds to its address again, and the
	 * store hands it the frame there, as it does any late binder — its island wakes on it, whoever's
	 * the answer. A minute off the page with nothing bound, the store let the frame go: the hole's own
	 * last answer is painted again (its island, unmounted as it left, took its markup with it). Still
	 * bound (a move, a failed refresh), it has nothing to catch up on.
	 */
	#put_back(): void {
		const endpoint = this.#endpoint();
		if (!endpoint || this.#bound()) return;
		const replayed = this.#bind(endpoint);
		const shown = this.#shown;
		if (!replayed && shown !== null && this.#answer.now.kind === 'answered')
			this.#box.post((turn) => this.#apply(shown, turn));
	}

	/**
	 * Warm this hole's HTML into the frame store ahead of its `when` — the `prefetch` schedule. No
	 * subscription is taken, so nothing is applied now; the later wake (`#server`) subscribes, the
	 * store replays the warm frame at once, and its `ensure` joins instead of fetching. A failed
	 * warm is harmless: the wake falls back to its own fetch. A hole already done or fetching has
	 * nothing left to warm.
	 */
	#prefetch_html() {
		if (!FRAMES) return;
		if (this.#answer.now.kind !== 'none' || this.#hole.now.kind === 'fetching' || !this.isConnected)
			return;
		const endpoint = this.#endpoint();
		if (!endpoint || !is_allowed_region_endpoint(endpoint)) return;
		const address = frameAddress(endpoint);
		if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'region.prefetch', ...dt_ids(this) });
		// oxlint-disable-next-line ogygia/no-silent-failures -- a warm ahead; the hole's own fetch asks again and says its failure
		void slots.frames
			?.ensure(address, this.#frame_fetcher(endpoint, false, 'ahead'), {
				priority: PRIORITY.ahead
			})
			?.catch(() => {});
	}

	/**
	 * The one network fetch for this hole's HTML — its own wake and a `prefetch` warm share it, so
	 * the frame store sees one fetcher shape per address. The endpoint's text, or the keep-fallback
	 * marker on a 204 (`keepFallback()` on the server). A revalidate bypasses the browser cache
	 * (the endpoint may answer `private, max-age`, and stale is the whole point of revalidating).
	 */
	#frame_fetcher(
		endpoint: string,
		revalidate: boolean,
		cls: LoadClass | (() => LoadClass)
	): FrameFetcher {
		return async (signal, flight) => {
			// HTML is content: on screen it never waits for the page's critical resources; off screen it
			// is background work (load-scheduler.ts). Every caller of the address shares this fetch, so
			// it goes at the most urgent one's class (its flight's). The holes window caps what one
			// page asks of the origin at once.
			// (a class that follows this hole's place on screen is re-read as it moves)
			const el = typeof cls === 'function' ? this : undefined;
			const slot = new LoadSlot({
				kind: 'content',
				cls,
				label: endpoint,
				el,
				flight,
				window: 'holes'
			});
			const release = await slot.ready;
			try {
				return await this.#fetch_region(
					endpoint,
					revalidate,
					fetch_priority_of(slot.cls()),
					signal
				);
			} finally {
				release();
			}
		};
	}

	#fetch_region(
		endpoint: string,
		revalidate: boolean,
		priority: 'high' | 'auto' | 'low',
		signal: AbortSignal
	) {
		const address = frameAddress(endpoint);
		return fetch_hole(endpoint, {
			revalidate,
			priority,
			signal,
			renewed: (fresh) => slots.frames?.renew(address, fresh)
		});
	}

	#lake_arm() {
		return {
			idle: (fire: () => void) => {
				if (this.#hole_armed()) this.#on_idle(fire, this.#hole);
			},
			visible: (fire: () => void, margin?: string) => {
				if (this.#hole_armed()) this.#on_visible(fire, margin, this.#hole);
			},
			media: (when: string, fire: () => void) => {
				if (this.#hole_armed()) this.#on_media(when, fire, this.#hole);
			},
			fetch_revalidate: () => this.#box.post((turn) => this.#fetch_html(turn, true)),
			wake_children: () => this.#wake_waiting_regions()
		};
	}

	#arm(when: string, fire: () => unknown, visible_margin?: string) {
		const owner: Leaves = fire === this.#fire_hydrate ? this.#wake : this.#hole;
		if (fire === this.#fire_hydrate && when !== 'interaction') this.#catch_early_input(fire);
		if (DEVTOOLS || (HOOK_REGION_WOKE && slots.hooks?.regionWoke)) {
			const raw = fire;
			fire = () => {
				if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'wake.fired', ...dt_ids(this), when });
				if (HOOK_REGION_WOKE) slots.hooks?.regionWoke?.({ el: this, when });
				return raw();
			};
		}
		// NON-user-initiated wakes start at BACKGROUND priority: `load` fires at boot, and a `visible`/`media`
		// island above the fold (or a media query that matches at load) fires right then too.
		// `background_start` lets a pending render or input task run first — main-thread order only; it
		// does not hold back the network (the load scheduler does that, below).
		// `idle` is skipped — it already waits for requestIdleCallback, so wrapping it would double-defer.
		// `interaction` is skipped — the user clicked and is waiting for THIS island to wake and replay the
		// click, so it must hydrate immediately (and it ships no JS until the click, so it never competes).
		//
		// WHEN the downloads a wake starts may go out is the load scheduler's (load-scheduler.ts): island
		// code waits for the painted document and the page's critical resources, background classes
		// share a small window, a gesture never waits. Each download asks for its own slot.
		// The background task is the armed state's too, like every listener here: one that runs after
		// it was left (the region left the page, an answer came another way, a visitor woke it first)
		// starts nothing (#335).
		const armed = owner.scope;
		const start = () => background_start(() => void (armed.closed || fire()));
		const trigger = on_trigger(
			when,
			WAKE,
			{
				idle: (f) => this.#on_idle(f, owner),
				visible: () => this.#on_visible(start, visible_margin, owner),
				load: start,
				media: (query) => this.#on_media(query, start, owner),
				interaction: (f) => {
					if (owner === this.#hole) {
						arm_on_demand(
							this,
							() => {
								this.#visitor = NO_REPLAY; // (a hole's answer: nothing of the visitor's to replay)
								return f();
							},
							owner.scope
						);
					} else this.#on_interaction(f);
				}
			},
			fire
		);
		if (!trigger)
			warn('region_wake_unknown', {
				region: this.getAttribute('entry') || this.getAttribute(OG_HOLE) || 'ogygia-region',
				value: when
			});
	}

	/**
	 * `wake="interaction"`: sleep until a pointer/key/focus/click lands inside the region, then
	 * hydrate and replay what arrived meanwhile (see runtime/interaction.ts). `pointerenter` warms
	 * the module so the wake is usually served from cache. On a csr=true page Kit already hydrated
	 * this island — do not arm (our click-cancel would eat live clicks); #hydrate's own guard
	 * handles the marking if it ever fires. Unless the island is ours even there: inside a lake
	 * (Kit adopts it as opaque DOM) or inside a hole's fetched answer (Kit never sees it).
	 */
	#on_interaction(fire: () => unknown) {
		if (kit_hydrates_page() && !ours_on_kit_document(this)) {
			this.setAttribute('data-kit-hydrated', '');
			return;
		}
		const arm = slots.interaction;
		if (!arm) {
			fire();
			return;
		}
		this.#hold_capture(arm(this, this.#by_visitor(fire), this.#life));
	}

	/**
	 * A scheduled island (`load` / `idle` / `visible` / media) also catches input until it is live — the
	 * interaction capture, armed beside its schedule: the first press, key or focus on it wakes it now,
	 * as a gesture, and a click is replayed once it is live. Not on a Kit-hydrated page (Kit owns the
	 * island there, as for `interaction`), not without the interaction feature, never once awake.
	 */
	#catch_early_input(fire: () => unknown) {
		const arm = slots.interaction;
		if (!arm || this.#app || (kit_hydrates_page() && !ours_on_kit_document(this))) return;
		this.#hold_capture(arm(this, this.#by_visitor(fire), this.#life));
	}

	#by_visitor(fire: () => unknown): (replayed: Promise<unknown>) => Promise<void> {
		return (replayed) => {
			this.#visitor = replayed;
			return Promise.resolve(fire()).then(() => {
				const s = this.#wake.now;
				// (offline: the visitor's input cannot wait for the network; the island wakes later)
				if (s.kind === 'failed' || s.kind === 'offline') throw s.error;
			});
		};
	}

	#hold_capture(disarm: void | ((over?: boolean) => void)): void {
		if (typeof disarm !== 'function') return;
		const wake = this.#wake;
		const hold = () => {
			if (wake.now.kind === 'waking') wake.scope.defer(hold);
			else disarm(!this.isConnected);
		};
		wake.scope.defer(hold);
	}

	/**
	 * Move this hole onto the fresh capability a renewal at its address answered (frame-store
	 * `renew`, whichever copy's fetch got it): the attribute (every DOM reader — lakes, devtools, the
	 * router's warm — agrees), the minted copy, and, should the address differ, the frame-store
	 * address its later wakes and revalidates fetch and apply at. Called once an answer landed — moving
	 * addresses mid-fetch would orphan that answer. A copy whose own capability has not expired keeps
	 * it (it can be newer than the renewal: a page rendered since).
	 */
	#adopt_renewed() {
		const address = this.#frame_address;
		const fresh = address ? slots.frames?.renewal(address) : null;
		const current = this.getAttribute('endpoint');
		if (!fresh || fresh === current || (current && !capability_expired(current))) return;
		this.#minted_endpoint = fresh;
		this.setAttribute('endpoint', fresh);
		if (this.#bound()) this.#bind(fresh);
	}

	#bind(endpoint: string): boolean {
		const address = frameAddress(endpoint);
		if (this.#bound() && this.#frame_address === address) return false;
		if (this.#hole.now.kind === 'fetching') this.#hole.go('idle');
		this.#binding?.close();
		const binding = (this.#binding = this.#life.child());
		this.#frame_address = address;
		binding.defer(() => {
			if (this.#binding === binding) this.#frame_address = null;
			if (RULES) note_unbound(this);
		});
		const box = this.#box;
		let replayed = false;
		const off = slots.frames?.subscribe(address, (f) => {
			replayed = true;
			if (RULES) note_handed(this, address, f.v, () => this.#paint.now.kind === 'painting');
			box.post((turn) => {
				if (RULES) note_turn(this);
				return this.#apply(f.html, turn, f.v);
			});
		});
		if (off) binding.defer(off);
		return replayed;
	}

	#bound(): boolean {
		return this.#binding !== null && !this.#binding.closed;
	}

	#endpoint(): string | null {
		const attr = this.getAttribute('endpoint');
		if (attr) return attr;
		if (!this.#minted_endpoint) return null;
		this.setAttribute('endpoint', this.#minted_endpoint);
		return this.#minted_endpoint;
	}

	#server(turn: Turn): Promise<void> | undefined {
		if (!FRAMES) return;
		const endpoint = this.#endpoint();
		const replayed = endpoint ? this.#bind(endpoint) : false;
		const run = replayed ? undefined : this.#fetch_html(turn);
		if (this.#hole.now.kind === 'armed') this.#hole.go('idle');
		return run;
	}

	/**
	 * A deferred client island's answer is in: arm its phase-2 wake — coalescing a schedule that
	 * matches the hole's own `when` to an immediate load. Once: an island already armed, waking, awake
	 * or failed is not armed again (a refresh morphs a live island in place).
	 */
	#arm_phase2(): void {
		if (this.#wake.now.kind !== 'cold' || this.#app || !this.isConnected) return;
		const hydrate = region_hydrate_schedule(this);
		if (!hydrate) return;
		const defer_when = this.getAttribute('when') || 'load';
		const phase2 = phase2_hydrate_schedule(defer_when, hydrate);
		const margin =
			phase2 === 'visible'
				? this.getAttribute('hydrate-margin') || this.getAttribute('margin') || undefined
				: undefined;
		register_region(this, this.#life);
		this.#wake.go('armed');
		this.#arm(phase2, this.#fire_hydrate, margin);
	}

	#answered(kind: 'answered' | 'kept'): void {
		this.#answer.go(kind);
		const hole = this.#hole.now.kind;
		if (hole === 'armed' || hole === 'retrying' || hole === 'offline' || hole === 'failed')
			this.#hole.go('idle');
	}

	/** A frame landed: it starts its paint visit (a frame still waiting for its sheets is older, and
	 *  its visit is over). Returns the visit, to check after the wait. */
	#paint_next(): Paint['now'] {
		this.#paint.go('painting');
		return this.#paint.now;
	}

	/** The frame of visit `painting` paints now: nothing is waiting any more, unless a newer frame
	 *  already started (a listener of this paint wrote one). */
	#painted(painting: Paint['now']): void {
		if (this.#paint.now === painting) this.#paint.go('idle');
	}

	#machines(): RegionMachinesNow {
		return {
			hole: this.#hole.now.kind,
			wake: this.#wake.now.kind,
			'live-region': this.#live.now.kind,
			'region-paint': this.#paint.now.kind
		};
	}

	/**
	 * THE single apply path. A frame's HTML lands here from any source (own fetch, stream parcel,
	 * navigation batch, mutation). First arrival hydrates the hole; a later arrival at a newer
	 * version (SWR revalidate, live refresh) re-applies. Keeps all the DOM-side work — lakes settle
	 * offline before custom elements connect, then swap, mark, event. HOLE-TRUST: the HTML is our own
	 * signed same-origin SSR.
	 */
	async #apply(html: VerifiedHtml, turn: Turn, v?: number) {
		if (!this.isConnected) return;
		// The newest frame: one still waiting for its sheets is older, and never paints over this one.
		const painting = this.#paint_next();
		// The hole answered "the fallback is right" (`keepFallback()` on the server — a 204, or the
		// marker parcel in a batch): keep what the page rendered, mark the region done, wake nothing.
		if (html === KEEP_FALLBACK_HTML) {
			this.#painted(painting);
			if (RULES && v !== undefined) note_shown(this, v);
			use_sheets(this, []); // (the fallback's sheets are the page's)
			this.#answered('kept');
			if (!is_awake(this)) this.setAttribute('data-hydrated', '');
			this.setAttribute(OG_KEPT, '');
			this.#adopt_renewed();
			this.dispatchEvent(new CustomEvent('ogygia:server', { bubbles: true }));
			return;
		}
		// A refresh replaces an answer already on screen: a later frame after the first answer, or
		// any frame into a lake (its content is always an earlier render). A hole's first answer is
		// never one, however it was fetched — even by a refetch (a re-minted hole), or after one failed.
		const revalidate = is_frozen(this) || this.#answer.now.kind === 'answered';
		const { frag, ready, sheets } = region_fragment(html);
		// let the server-picked component's stylesheet load before painting (no FOUC). STALE: the
		// region left the page meanwhile; a newer frame came meanwhile: it paints, this one never does.
		if ((await turn.wait(ready)) === STALE || this.#paint.now !== painting) return;
		this.#painted(painting);
		if (RULES && v !== undefined) note_shown(this, v);
		use_sheets(this, sheets);
		this.#shown = html;
		slots.lakes.settle_in(frag);
		slots.lakes.mark_frozen_settled(this);
		// A hole's answer swaps over its fallback — which may already be LIVE, on ANY schedule, not just
		// `interaction`: a foreign runtime (a web component) upgraded the fallback, or the visitor
		// opened a menu in it, before the answer landed (an idle answer arrives seconds after an
		// upgraded menu item became interactive). MORPH so those nodes and their state survive and the
		// answer's new children graft under them; a plain `replaceChildren` re-creates the fallback's
		// elements and destroys a menu that is open right now — its open branch closes and the deeper
		// links the answer just brought are never shown. Morph keys on `id`, and a hole's fallback and
		// answer render the same shell ids, so the open element keeps its identity. `replaceChildren`
		// is the floor for a build without morph (a defer-less app never reaches #apply; the `morph`
		// feature is now selected whenever the app has deferred holes — see link/runtime-entry.ts).
		const morph = slots.morph;
		// A hydrating hole's server markup IS the answer (see #ssr_html) — copied before it goes in.
		if (!this.#app && region_hydrate_schedule(this)) {
			this.#ssr_html = fragment_markup(frag);
			this.#watch(); // (the swap below is itself a touch: a hydrating hole compares, as before)
		}
		if (morph) morph(this, Array.from(frag.childNodes));
		else this.replaceChildren(frag);
		if (HOOK_ANSWER_PLACED) slots.hooks?.answerPlaced?.({ el: this });
		init_shadow_registries(this);
		absorb_page_facts_now();
		this.#answered('answered');
		// (a real answer after a kept fallback: the fallback is not what stands any more)
		this.removeAttribute(OG_KEPT);
		if (revalidate) this.setAttribute('data-revalidated', '');
		else if (!is_awake(this)) this.setAttribute('data-hydrated', '');
		// (a lake this settled wakes the regions inside that waited on it: morphed in place, nothing
		// reconnects them)
		slots.lakes.after_html_swap(this, { revalidate }, () => this.#wake_waiting_regions());
		if (HOOK_HOLE_ANSWERED && slots.hooks?.holeAnswered && !revalidate && this.#fetch_started) {
			const ep = this.getAttribute('endpoint');
			const batch = ep ? slots.frames?.batch_times?.(ep) : undefined;
			slots.hooks.holeAnswered({
				el: this,
				start: this.#fetch_started,
				...(batch ? { batch } : {})
			});
		}
		if (DEVTOOLS)
			dt_emit({
				domain: 'runtime',
				name: 'region.server.applied',
				entry: this.getAttribute('entry') || undefined,
				endpoint: this.getAttribute('endpoint') || undefined,
				bytes: html.length,
				revalidate,
				// the first answer: how long the fallback showed, from the fetch's start (retries included)
				...(!revalidate && this.#fetch_started
					? { wait_ms: Math.round(clock.mono() - this.#fetch_started) }
					: {})
			});
		// (whichever copy's fetch renewed the capability: this one moves onto it too)
		this.#adopt_renewed();
		this.dispatchEvent(new CustomEvent('ogygia:server', { bubbles: true }));
		// a deferred client island wakes on its answer, whoever fetched it
		this.#arm_phase2();
	}

	/**
	 * Store applicator for a STATIC live/held region (`<ogygia-region live>` with no interactive
	 * module). Every frame at its address lands here — first paint (store replay), a live-query tick,
	 * or a single-flight mutation. First paint swaps in; a later frame morphs in place (same node
	 * survives — the breathing update live partials rely on). Interactive live regions never reach
	 * here: they keep the imperative keep-alive path in {@link applyLive}.
	 */
	async #morph_live(html: VerifiedHtml, turn: Turn) {
		if (!this.isConnected) return;
		// BAKED (Region.svelte, PromiseRegionAwait): the first HTML is already here — the page was
		// served with it and hydrated against it. Nothing to paint; later ticks morph as usual (by
		// identity: Svelte's `{@html}` anchors stay among the children — ownership.ts `order_owner`).
		if (!this.#live_ready && this.hasAttribute(OG_BAKED)) {
			this.#live_ready = true;
			this.setAttribute('data-hydrated', '');
			this.dispatchEvent(new CustomEvent('ogygia:live', { bubbles: true }));
			return;
		}
		const painting = this.#paint_next();
		const { frag, ready, sheets } = region_fragment(html);
		// Wait for the component's stylesheet before painting. On first paint the region's placeholder
		// CHILDREN stay visible meanwhile; on a later morph the OLD content stays — either way no flash
		// of unstyled or missing content. An already-loaded sheet resolves instantly, so live ticks
		// (query.live breathing) stay fast. (STALE: the region left the page meanwhile; a newer tick
		// came meanwhile, static or interactive: it paints, this one never does, and an island an
		// interactive tick brought is not morphed over)
		if ((await turn.wait(ready)) === STALE || this.#paint.now !== painting) return;
		this.#painted(painting);
		use_sheets(this, sheets);
		slots.lakes.settle_in(frag);
		if (!this.#live_ready) {
			this.replaceChildren(frag);
			this.#live_ready = true;
			this.setAttribute('data-hydrated', '');
		} else {
			const nodes = Array.from(frag.childNodes);
			const morph = slots.morph;
			if (morph) morph(this, nodes);
			else this.replaceChildren(...nodes);
			// the holes this render re-minted: a new address fetches its new answer (the kept ones keep
			// theirs: same call, same page facts)
			for (const el of this.querySelectorAll('ogygia-region'))
				if (el instanceof OgygiaRegion) el.#box.post((t) => el.#renew(t));
		}
		if (HOOK_ANSWER_PLACED) slots.hooks?.answerPlaced?.({ el: this });
		init_shadow_registries(this);
		absorb_page_facts_now();
		this.dispatchEvent(new CustomEvent('ogygia:live', { bubbles: true }));
	}

	/**
	 * A refreshed region re-minted this hole (server/render-page.ts): at a new address — new props, or
	 * new page facts (`pv`) — it fetches its new answer, the current one on screen until that lands.
	 * A hole that never fetched yet fetches the new address on its own schedule.
	 */
	#renew(turn: Turn): Promise<void> | undefined {
		if (!this.#frame_address || !is_deferred(this)) return;
		const endpoint = this.getAttribute('endpoint');
		if (!endpoint || frameAddress(endpoint) === this.#frame_address) return;
		return this.#fetch_html(turn, true);
	}

	/**
	 * Fetch `endpoint` HTML into the store; the store's write swaps it in (#apply). One visit to the
	 * hole's `fetching`: it ends when the fetch does (idle), when it failed (`retrying`, `failed`), or
	 * when the region leaves the page (it leaves the shared fetch). A failure leaves the
	 * answer as it was, so a reconnect, a remount or the retry can try again — a transient network
	 * error never kills the hole for good.
	 * A `load` hole takes over the request the head started (HOLE-CACHE); an swr REVALIDATE must not
	 * reuse an answer (a hole that opts in is `private, max-age=<ttl>`, and stale is the whole point).
	 */
	async #fetch_html(turn: Turn, revalidate = false): Promise<void> {
		if (!FRAMES) return;
		// A revalidate re-fetches even after the first answer; a plain fetch is one-shot.
		if (!revalidate && this.#answer.now.kind !== 'none') return;
		const endpoint = this.#endpoint();
		// Don't start a fetch without an endpoint (would block a later remount retry on the same
		// element if one were ever scheduled).
		if (!endpoint) return;
		// (a fetch out at this address already does this; one out at an older address — a re-minted
		// hole — is left as it binds the new one, below)
		if (this.#hole.now.kind === 'fetching' && frameAddress(endpoint) === this.#frame_address)
			return;
		// HOLE-TRUST defense-in-depth: mint emits path-only; reject absolute/cross-origin attrs.
		if (!is_allowed_region_endpoint(endpoint)) {
			if (import.meta.env.DEV) {
				warn('region_endpoint_foreign', { endpoint });
			}
			return;
		}
		const frames = slots.frames;
		if (!frames) return;
		if (!this.#fetch_started) this.#fetch_started = clock.mono();
		// Bind if we haven't (SWR/lake remount reaches #fetch_html without going through #server);
		// a re-minted hole (a refreshed region: new props, new page facts) answers at its NEW address.
		this.#bind(endpoint);
		const address = frameAddress(endpoint);
		const s = this.#hole.now;
		const attempts = s.kind === 'armed' || s.kind === 'retrying' ? s.attempts : 0;
		this.#hole.go('fetching', { attempts, revalidate });
		const mine = this.#hole.now;
		let html: string | typeof STALE;
		try {
			// (buggify: the answer is lost on the way, as a dropped request's: the fetch fails, and
			// the hole tries again or gives up as it would)
			if (RULES && buggify.fires('hole.fetch-lost')) throw new TypeError('Failed to fetch');
			// (the network is no turn of the element's: the frames that come meanwhile land as it waits)
			html = await turn.wait(
				this.#hole.scope.task((signal) =>
					this.#ensure_frame(frames, endpoint, address, revalidate, signal)
				)
			);
		} catch (err) {
			// A task fails only while it is still its visit (leaving — the region gone — answers
			// STALE), and the failure comes back in a turn only while the region is on the page; a
			// visit ended another way meanwhile has nothing left to retry or to fail.
			if (this.#hole.now !== mine) return;
			return this.#fetch_failed(turn, err, endpoint, revalidate, attempts + 1);
		}
		// Network went to the STORE, not the DOM: the write notified our subscriber, which is the
		// single apply path (a twin may have applied before us: then this was a no-op). STALE, or a
		// visit already over: the region left the page meanwhile, and left the fetch.
		if (html !== STALE && this.#hole.now === mine) this.#hole.go('idle');
	}

	/**
	 * The network side of one visit to `fetching`, through the frame store: N regions with the same
	 * address ⇒ one request, and a stale response can't overwrite a newer one (the store tickets at
	 * request time). `signal` is the visit's: leaving it (the region left the page) lets THIS region
	 * go (`STALE`), never a twin — the shared fetch is aborted only once its last caller left.
	 */
	async #ensure_frame(
		frames: FrameOps,
		endpoint: string,
		address: string,
		revalidate: boolean,
		signal: AbortSignal
	): Promise<string | Stale> {
		// A first fetch joins the holes starting with it in ONE batch request (frame-nav.ts
		// `join_batch`) — not a cacheable hole (`ttl`: its GET is the browser cache's to answer) and
		// not an expired capability (only its own GET renews it).
		if (!revalidate && frames.join && !endpoint.includes('&ttl=') && !capability_expired(endpoint))
			await frames.join(endpoint);
		const cls = () => (this.#visitor ? 'user' : viewport_class(this));
		const fetcher = this.#frame_fetcher(endpoint, revalidate, cls);
		// (joining a warm out for the address: it is raised to this hole's class; a batch that did
		// not carry it is no failure: the store asks again, and its own fetch runs)
		return frames.ensure(address, fetcher, {
			force: revalidate,
			signal,
			priority: PRIORITY[cls()]
		});
	}

	/**
	 * A fetch of this hole failed (never its own leaving: that is no failure). Said in dev, told to the
	 * profiler and the devtools; then a retry waits in `retrying` (called off by an answer that comes
	 * another way, a new schedule, or the region leaving), or, refused or out of tries, it gives up.
	 */
	async #fetch_failed(
		turn: Turn,
		err: unknown,
		endpoint: string,
		revalidate: boolean,
		attempts: number
	): Promise<void> {
		// A refused answer is deterministic (a redirect rule in front of the handle, a refused
		// capability, not a flaky network): say what answered instead and do not retry.
		const refused = err instanceof RegionAnswerRefused;
		// (a refused capability's reason travels as the failure's message)
		const deny = refused && err.reason === 'forbidden' ? err.deny || 'no reason given' : undefined;
		// No response while the browser is offline: the network's failure, not the server's. It waits
		// for the network, however many tries are left (#891, ./network.ts).
		const offline = !refused && this.isConnected && no_response(err) && browser_offline();
		const final = !offline && (refused || !this.isConnected || attempts >= region_fetch.attempts);
		// (each failure in dev; in a production build the give-up, once, by its code)
		if (import.meta.env.DEV || final) {
			if (deny !== undefined) {
				warn('region_answer_denied', { endpoint, deny });
			} else if (refused) {
				warn('region_answer_redirected', {
					endpoint,
					how: err.reason === 'redirected' ? 'redirected' : 'document',
					final_url: err.final_url
				});
			} else {
				warn('region_fetch_failed', { endpoint }, err);
			}
		}
		// the profiler's browser half: the hole that kept its fallback, by its island id
		if (HOOK_HOLE_FAILED && final && slots.hooks?.holeFailed) {
			let id = '';
			let final_path: string | undefined;
			try {
				id = new URL(endpoint, location.href).searchParams.get('id') ?? '';
				if (refused) final_path = new URL(err.final_url, location.href).pathname;
			} catch {
				// ok: an endpoint URL that was fetched parses; the message goes without its id if not
			}
			if (id)
				slots.hooks.holeFailed?.({
					el: this,
					id,
					reason: refused ? err.reason : 'error',
					...(final_path ? { finalPath: final_path } : {}),
					...(refused
						? {}
						: {
								message: String((err as Error)?.message ?? err)
									.split('\n')[0]
									.slice(0, 200)
							}),
					...(deny !== undefined ? { message: deny.slice(0, 200) } : {}),
					attempts,
					t: Math.round(clock.mono())
				});
		}
		if (DEVTOOLS)
			dt_emit({
				domain: 'runtime',
				name: 'region.server.failed',
				entry: this.getAttribute('entry') || undefined,
				endpoint,
				reason: refused ? err.reason : 'error',
				...(refused
					? { final_url: err.final_url }
					: {
							message: String((err as Error)?.message ?? err)
								.split('\n')[0]
								.slice(0, 200)
						}),
				...(deny !== undefined ? { message: deny.slice(0, 200) } : {}),
				attempt: attempts,
				final
			});
		// a connect again (its retry, or a reconnect) schedules afresh
		this.#region.move('scheduled', 'connected', lifetime_of(this.#region.now));
		if (!final) {
			// (an answer already stands: a refresh that failed is not tried again)
			if (this.#answer.now.kind !== 'none') {
				this.#hole.go('idle');
				return;
			}
			if (offline) {
				// (its listener is the state's: an answer another way, or the region leaving, drops it)
				this.#hole.go('offline', { revalidate });
				const waiting = this.#hole.scope;
				const back = await turn.wait(
					waiting.task(
						() => new Promise<void>((resolve) => waiting.on(window, 'online', () => resolve()))
					)
				);
				if (back === STALE) return;
				if (revalidate) return this.#fetch_html(turn, true);
				return this.#connect(turn);
			}
			this.#hole.go('retrying', { attempts, revalidate });
			const retrying = this.#hole.scope;
			// a 429 says when the endpoint's window is over: the next try waits it out (#959)
			const later = err instanceof RegionAnswerLater ? err.wait_ms : null;
			const wait =
				later === null
					? backoffAfter(region_fetch, attempts)
					: Math.min(later, backoffAfter(region_rate_limited, attempts));
			const waited = await turn.wait(
				retrying.task(() => new Promise<void>((resolve) => retrying.timeout(resolve, wait)))
			);
			// (STALE: called off, or the region left the page meanwhile)
			if (waited === STALE) return;
			if (revalidate) return this.#fetch_html(turn, true);
			return this.#connect(turn);
		}
		this.#hole.go('failed');
		slots.lakes.after_fetch_exhausted(this, { revalidate }, () => this.#wake_waiting_regions());
	}

	/** Re-enter connectedCallback for descendants that early-returned on an unsettled lake. */
	#wake_waiting_regions() {
		for (const el of this.querySelectorAll('ogygia-region')) {
			if (el instanceof OgygiaRegion) el.connectedCallback();
		}
	}

	// The schedules' listeners. Each is dropped when `owner` leaves the state it was armed in (the
	// schedule fired and the machine moved on, or the region left the page): one region arming two
	// schedules — `when` and `prefetch`, a hole's `when` and its island's `wake` — keeps both, and
	// drops both.

	#on_idle(fire: () => unknown, owner: Leaves) {
		const s = owner.scope;
		// (no idle time in this browser: a short pause stands in for it)
		if (!('requestIdleCallback' in window)) {
			s.timeout(() => fire(), 200);
			return;
		}
		// idle time, or 2 s at the latest: whichever comes first fires, once
		const first = () => {
			off_idle();
			off_cap();
			fire();
		};
		const off_idle = s.timeout(first, 'idle');
		const off_cap = s.timeout(first, 2000);
	}

	/** `visible`: the one viewport tracker for this margin (viewport.ts) — fires once, the first time
	 *  the region (or, with no box of its own, what it renders) is on screen. */
	#on_visible(fire: () => unknown, root_margin: string | undefined, owner: Leaves) {
		const rootMargin = root_margin || this.getAttribute('margin') || '0px';
		owner.scope.defer(once_on_screen(this, rootMargin, () => void fire())); // ok: a wake; its hydrate says its own failure
	}

	#on_media(q: string, fire: () => unknown, owner: Leaves) {
		const mql = matchMedia(q);
		if (mql.matches) return void fire(); // ok: a wake; its hydrate says its own failure
		const off = owner.scope.on(mql, 'change', (e) => {
			if (!e.matches) return;
			off();
			fire();
		});
	}

	/**
	 * Wake this island: load its module and the hydrate core in parallel, then take a SCHEDULER
	 * TURN (one island per task, viewport first — schedule.ts) and run the synchronous hydrate step
	 * (hydrate-core.ts) inside it.
	 */
	async #hydrate(turn: Turn) {
		const from = this.#wake.now.kind;
		// (a wake already under way, or over: nothing to do. `cold` is let through so the machine
		// refuses it out loud: every fire runs in `armed`, test/machine-steps.test.ts)
		if (this.#app || (from !== 'cold' && from !== 'armed')) return;
		// (leaving `armed` drops the schedule's listeners: it fired, or a visitor came first)
		this.#wake.go('waking');
		const mine = this.#wake.now;
		/** What this wake waits on is its visit's: leaving `waking` ends it. */
		const visit = this.#wake.scope;
		/** After each wait, back in its turn: the region left the page (`STALE`: its mailbox closed, the
		 *  one it came back with wakes it), or is on its way out (its teardown a microtask away), or the
		 *  visit is over. Checked after every wait before the turn. */
		const gone = (back?: unknown) => back === STALE || !this.isConnected || this.#wake.now !== mine;
		let failure: { error: unknown } | null = null;
		/** Its code failed to download while offline: it waits for the network, no failure. */
		let offline: { error: unknown } | null = null;
		const t0 = now_ms();
		const dt_t0 = DEVTOOLS ? t0 : 0;
		let t_loaded = t0;
		/** when its hydrate step began: a failed step held the thread from here (the reports count it busy) */
		let t_turn: number | undefined;
		if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'region.hydrate.start', ...dt_ids(this) });
		if (HOOK_REGION_MOUNT) client_region_mount(this);
		try {
			// wait for full parse so the end-of-body props sidecars (and the seed) are in the DOM. On an
			// SPA swap (and any post-load hydrate) the document is already parsed, so skip the await
			// entirely — no need to burn a microtask turn before every island wakes.
			if (typeof document !== 'undefined' && document.readyState === 'loading')
				if (gone(await turn.wait(dom_ready()))) return;
			// SWR remount (and SPA swaps) can disconnect an island-in-lake while its module load is
			// in flight — abort rather than hydrate into a detached tree (SWR-ORPHAN-HYDRATE).
			if (gone()) return;
			const entry = island_entry_of(this);
			if (!entry) return;
			// Its downloads wait for their slot (load-scheduler.ts): a gesture's never wait; otherwise
			// the class follows the viewport, re-read while queued (an island scrolled into view moves up).
			const cls = () => (this.#visitor ? 'user' : viewport_class(this));
			const slot = new LoadSlot({ kind: 'code', cls, label: entry, el: this });
			const release = await turn.wait(slot.ready);
			// (gone while it queued: the slot, when it comes, goes straight back)
			if (release === STALE) return void slot.ready.then(hand_back); // ok: a slot's turn never fails
			// (a part that went STALE, the hydrate core's download or devalue's, makes the whole wait
			// STALE: no slot is checked on its own)
			let mod: IslandModule, core: HydrateCore;
			try {
				if (gone()) return;
				hydrate_started(this); // a viewport island in flight holds ready islands below the fold
				// (with the module: the transportable classes its props and context carry — runtime/wire-classes.ts,
				// a feature only an app with transportable classes installs)
				// The island's module first: its graph links go in before the lazy runtime chunks' own preloads.
				const loaded = await turn.wait(
					Promise.all([
						load_island(entry, cls()),
						hydrate_core.get(),
						slots.wire_classes?.(this),
						wire_for_wake(this),
						devalue_for_wake()
					])
				);
				if (loaded === STALE) return;
				[mod, core] = loaded;
			} finally {
				release();
			}
			t_loaded = now_ms();
			if (gone()) return;
			use_code_sheets(this, mod);
			// An island of OURS on a Kit-hydrated document reads Kit's page through the bridge Kit's
			// client entry publishes; it must not hydrate before Kit applied it (kit-page-thread.svelte.ts).
			if (gone(await turn.wait(this.#kit_page_ready(core, visit)))) return;
			// The page's seeds parse now, BEFORE the turn: data arriving is not the hydrate step. The
			// first island parses the seed once (700 KB on a large CMS page), and inside its turn that
			// parse plus the hydrate made one long task. (The step calls these again: a no-op by then.)
			core.seed_remote_once();
			core.seed_page_once();
			// A visitor woke it (or reached it while it loaded): what replays their input is in before
			// the island is live, so the input lands AT wake. Live first, the replay came in later over
			// a slow network, beside the visitor's next click (#260). A visitor who came while it waited
			// for its turn: their replay too, and a turn after it.
			let visitor: Promise<unknown> | null;
			do {
				visitor = this.#visitor;
				// (a replay that failed says so itself)
				if (visitor && gone(await turn.wait(visitor.catch(nothing)))) return;
				if (gone()) return;
				// (the scheduler's task is the turn: back in it at once, the hydrate step runs inside it)
				if (gone(await turn.wait(hydrate_turn(this))) || this.#app) return;
			} while (this.#visitor !== visitor);
			// ── the turn: everything below is one synchronous step ──
			t_turn = now_ms();
			const ssr_html = this.#ssr_html;
			// Was the island touched while it slept (runtime/drift-watch.ts)? Read HERE, before the
			// hydrate step edits it (lakes lifted): an untouched island skips the parse-and-compare.
			const touched = ssr_html === null || region_changed(this);
			// (dev: a Svelte hydration warning raised in this step is this island's)
			if (import.meta.env.DEV) set_hydrating(this, this.#life);
			this.#app = core.hydrate_island(this, entry, mod, ssr_html, touched);
			this.#ssr_html = null; // awake (or not ours): the server copy has done its job
			this.#unwatch();
			if (!this.#app) return; // not ours (Kit-hydrated page) or torn out mid-hydrate
			if (RULES) note_mount(this);
			const t_done = now_ms();
			// (Svelte's `hydrate()` runs `$effect` and onMount in a microtask it queued during the call; one
			// awaited now runs after it — mounted means they ran)
			await Promise.resolve();
			const t_mounted = now_ms();
			// The live snippets it renders hydrate after it (their entries import): it is awake once they
			// are, so `data-hydrated` and the event wait for them. Its own timings stay its own.
			if (gone(await turn.wait(snippets_settled(this, visit))) || !this.#app) return;
			this.setAttribute('data-hydrated', '');
			if (HOOK_REGION_HYDRATED)
				slots.hooks?.regionHydrated?.({
					el: this,
					t0,
					tLoaded: t_loaded,
					tTurn: t_turn,
					tDone: t_done,
					ssrHtml: ssr_html
				});
			if (DEVTOOLS)
				dt_emit({
					domain: 'runtime',
					name: 'region.hydrate.done',
					...dt_ids(this),
					ms: t_mounted - dt_t0
				});
			this.dispatchEvent(new CustomEvent('ogygia:hydrated', { bubbles: true }));
		} catch (err) {
			// A run whose visit is over fails quietly: the region left while it loaded, and what stands
			// now (the region put back) is a new visit, which loads, fails or wakes on its own.
			if (this.#wake.now !== mine) return;
			// Its code did not download while the browser is offline: the network's failure. It wakes
			// again once the browser is back online (below), the file asked for afresh (#891).
			if (is_failed_import(err) && browser_offline()) {
				offline = { error: err };
				return;
			}
			failure = { error: err };
			// (a failed island stops being watched; its copy, if kept, counts as changed from here)
			if (this.#watching) mark_region_changed(this);
			this.#unwatch();
			if (HOOK_REGION_FAILED)
				slots.hooks?.regionFailed?.({
					el: this,
					message: (err as { message?: string })?.message ?? String(err),
					since: t0,
					turn: t_turn
				});
			if (DEVTOOLS)
				dt_emit({
					domain: 'runtime',
					name: 'region.hydrate.failed',
					...dt_ids(this),
					message: (err as { message?: string })?.message ?? String(err),
					...(t_turn !== undefined ? { turn: t_turn } : {})
				});
			say_island_failed(this.getAttribute('entry'), err);
		} finally {
			// live (or failed, or not ours): leaving `waking` disarms the capture — its clicks are its own
			// from here (a click it already queued is still replayed by the wake that queued it). Not
			// when the visit is over already: the region left the page, and its teardown moved it and
			// took it out of the scheduler (the scheduler's mark, if any, is the new visit's).
			if (this.#wake.now === mine) {
				hydrate_settled(this);
				if (failure) this.#wake.go('failed', failure);
				else if (offline) this.#wake_online(offline.error);
				else this.#wake.go(this.#app ? 'awake' : 'cold');
			}
		}
	}

	/** Its code failed to download offline: in `offline` until the browser is back online, then it
	 *  wakes again (the listener is the state's: the region leaving drops it). */
	#wake_online(error: unknown): void {
		this.#wake.go('offline', { error });
		this.#wake.scope.on(window, 'online', () => {
			this.#wake.go('armed');
			void this.#fire_hydrate(); // ok: a wake; its hydrate says its own failure
		});
	}

	/**
	 * Apply a live region tick (called by Region.svelte for a deferred region whose ticket
	 * carries server-rendered HTML). No fetch — the HTML is already here.
	 *
	 * - **First tick:** parse + swap the HTML in. Interactive (`hydrate` + `module`) → hydrate a
	 *   pushable props so later ticks can push them. Static → done (no JS ever ships).
	 * - **Later tick, same interactive module:** keep-alive — push the new props to the mounted
	 *   component (focus + local state survive; Svelte reconciles). No swap, no re-hydrate.
	 * - **Later tick, static:** morph the new HTML in place (see {@link morph_children}).
	 * - **Later tick, module changed:** unmount, swap, re-hydrate.
	 */
	async applyLive(desc: LiveTick): Promise<void> {
		// (a live region is a `frames` build: none here — runtime-flags `FRAMES`)
		if (!FRAMES) return;
		// (what it goes on with, put back on the page: #337)
		this.#live_last = desc;
		await this.#box.ask((turn) => this.#apply_live(desc, turn));
	}

	/**
	 * A live region put back on the page (#337) goes on with its last tick: leaving it disposed its
	 * island or dropped its subscription. A static one binds to its address again, where the store
	 * hands it the newest frame (or, when it let that go, the last tick's HTML is painted again); an
	 * interactive one swaps and hydrates its island again. Still in its mode (a move), it has nothing
	 * to catch up on.
	 */
	#live_put_back(turn: Turn): Promise<void> | undefined {
		const last = this.#live_last;
		if (last === null || this.#live.now.kind !== 'idle') return;
		// (in the connect's turn: the turn is the tick's until it ends)
		return this.#apply_live(last, turn);
	}

	/** One live tick, in its turn (or its last tick, gone on with as it is put back). */
	async #apply_live(desc: LiveTick, turn: Turn): Promise<void> {
		// Keep the element self-describing so the fallback fetch path still works if ever needed.
		this.setAttribute('render', 'defer');
		this.setAttribute('entry', desc.module || desc.id);
		if (desc.url) this.setAttribute('endpoint', desc.url);
		if (desc.hydrate) this.setAttribute('wake', desc.hydrate);
		else this.removeAttribute('wake');
		if (desc.hydrateMargin) this.setAttribute('hydrate-margin', desc.hydrateMargin);

		const interactive = !!desc.hydrate && !!desc.module;

		// Static live/held region → the frame store is its single applicator. Every static frame — the
		// first paint, a `query.live` tick, or a SINGLE-FLIGHT mutation — flows through `#morph_live`
		// (first swap, then breathing morph). Binding also catches OUT-OF-BAND writes: a command that
		// returns `await region(C, props)` is decoded on its own response and written at this same
		// address (id|props), so the mounted region morphs with NO extra fetch. Subscribe once: the
		// subscription belongs to `static` (an interactive tick taking over drops it), and entering
		// `static` disposes an island an interactive tick hydrated.
		if (!interactive) {
			const now = this.#live.now;
			const bound = now.kind === 'static' ? now.bound : { address: null };
			if (now.kind !== 'static') this.#live.go('static', { bound });
			const frames = slots.frames;
			if (desc.url && bound.address === null) {
				// (each frame a turn of its own, the one the store hands over as it binds too)
				const box = this.#box;
				const address = frameAddress(desc.url);
				const off = frames?.subscribe(address, (f) => {
					box.post((t) => {
						if (older_by(f, this.#live_painted) !== null) return;
						this.#live_painted = stands_at(this.#live_painted, f);
						return this.#morph_live(f.html, t);
					});
				});
				if (off) {
					bound.address = address;
					this.#live.scope.defer(off);
				}
			}
			// The store's one ordering (`older_by`) decides. A tick stands where its HTML was written at
			// its address, or, written nowhere, at its arrival (the store's next ticket, taken once: put
			// back, it is the same tick). It paints its own HTML only when it is newer than both the
			// answer the store holds (that one, its write or newer, the subscription paints) and what is
			// on screen (put back after the store let the address go, what it showed stays: #774) —
			// test/browser/region-orderings.test.ts.
			const address = desc.url ? frameAddress(desc.url) : null;
			const held = address && frames ? frames.peek(address) : null;
			const mine = address && frames ? (desc.written ??= { v: frames.ticket(address) }) : null;
			// (a live tick is our server's render, through the app's remote transport)
			const html = vouch_remote_answer(desc.html);
			if (mine === null) await this.#morph_live(html, turn);
			else if (older_by(mine, held) === null && older_by(mine, this.#live_painted) === null) {
				this.#live_painted = stands_at(
					held && held.v > (this.#live_painted?.v ?? 0) ? held : this.#live_painted,
					mine
				);
				await this.#morph_live(html, turn);
			}
			return;
		}

		// (an island takes the screen: no frame is on it, and the next static tick's frame is newer)
		this.#live_painted = null;
		const s = this.#live.now;
		// Keep-alive: same interactive module, already mounted → reactive prop push, no DOM churn.
		if (s.kind === 'live' && s.module === desc.module) {
			s.app.set_props?.(desc.props);
			this.dispatchEvent(new CustomEvent('ogygia:live', { bubbles: true }));
			return;
		}
		// Same module, its island still hydrating: its props are pushed once it is live (the latest
		// tick's), never a second island on the same node.
		if (s.kind === 'hydrating' && s.module === desc.module) {
			s.pending.props = desc.props;
			return;
		}
		// Same module, its island's file could not load (said once): the tick's server HTML shows, and
		// nothing loads again (#942, test/browser/live-region-failed-file.test.ts)
		if (s.kind === 'failed' && s.module === desc.module)
			return this.#morph_live(vouch_remote_answer(desc.html), turn);

		// First tick, the interactive module changed, or it was static: swap + hydrate. (Leaving `live`
		// disposes its island; leaving `static` drops its subscription; leaving `hydrating` ends that
		// tick's hydrate before it mounts.)
		const pending: { props: Record<string, unknown> | null } = { props: null };
		this.#live.go('hydrating', { module: desc.module, pending });
		const mine = this.#live.now;
		const painting = this.#paint_next();
		this.#live_ready = true;
		// The HTML sink's trust boundary (HOLE-TRUST, ./html-sink.ts): a live tick is rendered
		// in-process on our server and reaches us through the app's remote transport.
		const { frag, ready, sheets } = region_fragment(vouch_remote_answer(desc.html));
		// stylesheet before paint — an interactive held region has CSS too (no FOUC). (STALE: the
		// region left the page meanwhile; another tick took over: it paints)
		if ((await turn.wait(ready)) === STALE || this.#live.now !== mine) return;
		this.#painted(painting);
		use_sheets(this, sheets);
		slots.lakes.settle_in(frag);
		this.replaceChildren(frag);
		if (HOOK_ANSWER_PLACED) slots.hooks?.answerPlaced?.({ el: this });
		init_shadow_registries(this);
		await this.#live_hydrate(desc.props, mine, desc.module, pending, turn);
	}

	/**
	 * On a Kit-hydrated document, a region of ours (a lake's inside, a hole's answer) waits for Kit to
	 * apply its page before it hydrates — `null` (no await) once applied. The wait lives in the lazy
	 * hydrate core (it observes Kit's reactive page, i.e. it needs Svelte), so it never reaches the boot.
	 * It waits for `visit` (the wake's, or the live tick's): a region that left stops waiting, and the
	 * wait ends with the last region in it.
	 */
	/** Fails with `kit_boot_failed` when Kit can no longer start (its own files failed to load). */
	#kit_page_ready(core: HydrateCore, visit: Scope): Promise<unknown> | null {
		if (!kit_hydrates_page() || !ours_on_kit_document(this)) return null;
		return core.kit_page_thread(visit.signal);
	}

	/**
	 * Hydrate a live region's swapped-in HTML through the hydrate core's live path — for the visit to
	 * `hydrating` that swapped it (`mine`): a later tick that took over (another module, a static
	 * tick) or the region leaving ends it before it mounts. One whose island could not load or
	 * hydrate goes `failed`, said once, coded: the same module's later ticks show their HTML and start
	 * nothing (#942). One that did not mount for another reason goes back to `idle`.
	 */
	async #live_hydrate(
		props: Record<string, unknown>,
		mine: Live['now'],
		module: string,
		pending: { props: Record<string, unknown> | null },
		turn: Turn
	) {
		/** Back in its turn after a wait: the region left the page (`STALE`), is on its way out, or
		 *  another tick took over. */
		const ours = (back?: unknown) => back !== STALE && this.isConnected && this.#live.now === mine;
		try {
			// A pushed tick is no user gesture either: its island code asks for a slot like any
			// scheduled wake (load-scheduler.ts).
			if (!ours(await turn.wait(dom_ready()))) return;
			const entry = island_entry_of(this);
			if (!entry) return;
			const cls = () => viewport_class(this);
			const slot = new LoadSlot({ kind: 'code', cls, label: entry, el: this });
			const release = await turn.wait(slot.ready);
			// (gone while it queued: the slot, when it comes, goes straight back)
			if (release === STALE) return void slot.ready.then(hand_back); // ok: a slot's turn never fails
			let mod: IslandModule, core: HydrateCore;
			try {
				if (!ours()) return;
				const loaded = await turn.wait(
					Promise.all([load_island(entry, cls()), hydrate_core.get(), devalue_for_wake()])
				);
				if (loaded === STALE) return;
				[mod, core] = loaded;
			} finally {
				release();
			}
			if (!ours()) return;
			use_code_sheets(this, mod);
			// (Kit cannot start: the region keeps its swapped HTML, and the wait said why)
			const kit = await turn.wait(this.#kit_page_ready(core, this.#live.scope)).catch((err) => {
				if (kit_boot_failed(err)) return STALE;
				throw err;
			});
			if (!ours(kit)) return;
			if (HOOK_REGION_MOUNT) client_region_mount(this);
			const app = core.hydrate_live(this, entry, mod, props);
			if (!app) return;
			this.#live.go('live', { module, app });
			// (leaving `live` — a static tick, another module, the region gone — disposes it)
			this.#live.scope.defer(() => {
				if (HOOK_REGION_UNMOUNT)
					slots.hooks?.regionUnmount?.({ el: this, entry: this.getAttribute('entry') ?? '' });
				app.dispose();
			});
			// (the latest same-module tick that came while it hydrated: its visit's)
			if (pending.props) app.set_props?.(pending.props);
			this.setAttribute('data-hydrated', '');
			this.dispatchEvent(new CustomEvent('ogygia:hydrated', { bubbles: true }));
			this.dispatchEvent(new CustomEvent('ogygia:live', { bubbles: true }));
		} catch (error) {
			// (a tick that took over, or the region gone: the failure is no longer this visit's)
			if (this.#live.now !== mine) return;
			say_island_failed(this.getAttribute('entry'), error);
			this.#live.go('failed', { module, error });
		} finally {
			if (this.#live.now === mine) this.#live.go('idle');
		}
	}

	/**
	 * A MOVE IS NOT A REMOVAL. Another script relocating the element (a custom element that, at its
	 * upgrade, moves its server-placed children out of its markup and back into its own light DOM)
	 * disconnects and reconnects it in one task. Tearing down there aborted a hole's in-flight
	 * fetch, re-armed its wake and fetched it again; disposed a woken island and woke it again. The
	 * teardown waits a microtask and runs only if the element is still out of the document. The
	 * reconnect itself runs as any connect: a region already `scheduled` stops there, and one that
	 * was not (a nested island a lake lifted out and put back, now under a frozen boundary) decides
	 * afresh where it stands. (Several leaves in one task end one lifetime: the first teardown
	 * detaches it, and the others find it detached.)
	 */
	disconnectedCallback() {
		tasks.micro(() => {
			if (!this.isConnected && this.#region.now.kind !== 'detached') this.#teardown();
		});
	}

	#teardown() {
		unregister_region(this);
		// out of the document nothing watches it: a copy it keeps is compared if it wakes again (its
		// sleep ends with its lifetime, below)
		if (this.#watching) mark_region_changed(this);
		// Out past the task it left in: the island is gone (a move came back before the microtask).
		if (HOOK_REGION_UNMOUNT && this.#app)
			slots.hooks?.regionUnmount?.({ el: this, entry: this.getAttribute('entry') ?? '' });
		// a live region: leaving its mode disposes its island (the plugins told) or drops its
		// subscription
		if (this.#live.now.kind !== 'idle') this.#live.go('idle');
		// The hole's fetch and the island's wake go back to rest: leaving their states drops every
		// schedule listener armed in them, calls off a retry it waited for, and takes this region
		// out of a shared fetch (aborted only if it was the last one in it). The answer
		// stays: a region put back keeps what it showed.
		if (this.#hole.now.kind !== 'idle') this.#hole.go('idle');
		if (this.#wake.now.kind !== 'cold') this.#wake.go('cold');
		// A frame still waiting for its sheets never paints now (its wait comes back STALE): its paint
		// visit ends here, with the region's lifetime, not at each wait (#1132).
		if (this.#paint.now.kind !== 'idle') this.#paint.go('idle');
		// (every region machine is at rest now: the rule holds it there, ./rules.ts `note_left`)
		if (RULES) note_left(this, () => busy_machines(this.#machines()));
		// Its lifetime in the page ends: its count among the connected regions, its sleep, its
		// viewport snapshot, its binding to the store, a replay still waiting for its frame, and its
		// mailbox (what is queued is dropped; a step that waits gets STALE). A connect again starts
		// afresh.
		this.#life.close();
		this.#region.go('detached', detached());
		if (this.#app) {
			this.#app.dispose();
			this.#app = null;
			if (RULES) note_unmount(this);
		}
	}
}

/**
 * Boot the always-on custom element after each selected feature has filled its {@link slots} entry.
 * Core never statically imports an optional feature — the generated entry (or {@link ./full.js})
 * passes each feature's `install` here, in {@link ../vite/runtime-entry.js FEATURE_ORDER}. Order is
 * load-bearing: `live` needs `morph` present first.
 */
/**
 * DEV ONLY: apply the region-CSS `<link data-ogygia-region-css>`s the SSR baked into the document.
 * In dev there is no extracted `.css` asset — `islandCss` hands a region its dev MODULE url as the
 * href, and a `<link rel="stylesheet">` to a JS module makes an EMPTY sheet (the server serves it as
 * `text/javascript`), so CSS authored in any hole or region silently never applied on first load.
 * Import each module instead — executing it injects the scoped `<style>` (Vite's dev CSS mechanism),
 * the exact rescue {@link region_fragment} already runs for a FETCHED answer, here for the links that
 * shipped on the page. Prod links a real `.css` asset, so `import.meta.env.DEV` DCEs this whole path.
 * Deferred to {@link dom_ready}: the runtime bootstrap is the FIRST node in `<head>`, so the region
 * links below it are not parsed yet at boot.
 */
function apply_dev_head_region_css(): void {
	if (!import.meta.env.DEV || typeof document === 'undefined') return;
	void dom_ready().then(() => {
		// EVERY region-css link is imported here — including one for an island that will wake on its
		// own. The server-rendered markup must be styled BEFORE the island wakes: a `visible` island
		// below the fold, or an `interaction` island nobody clicks, may not wake for a long time or ever,
		// and until then its markup sits unstyled (a hero's `min-height` collapsing to 0 — the CLS the
		// region-css link exists to prevent). Prod styles an unwoken island from load (its link is a
		// real `.css` asset); dev matches only by executing the module now, so the scoped `<style>`
		// injects now. (An earlier cut skipped waking islands to avoid front-loading their dep
		// discovery — wrong trade, and moot: island deps are pre-bundled at server start through
		// `optimizeDeps.entries`, so importing every island here discovers nothing and re-optimizes
		// nothing. Importing early is also what `warm_island_module` already does on hover/prefetch.)
		const seen = new Set<string>();
		for (const link of document.querySelectorAll(`link[${OGYGIA_REGION_CSS}]`)) {
			const href = link.getAttribute('href');
			// A real `.css` asset is a valid stylesheet — leave it. Only a dev MODULE url (`islandCss`'s
			// dev href) masquerading as a sheet loads empty and needs importing instead.
			if (!href || CSS_ASSET_HREF_RE.test(href)) continue;
			link.remove(); // inert either way (an empty sheet) — drop it so nothing dedupes against it
			// The href is DOCUMENT-relative (`../../@id/…` on a nested route, base-aware by design). A bare
			// `import()` would resolve it against THIS module's url (`/node_modules/…/og-runtime.js` in an
			// app) and 404 on `/node_modules/@id/…` — the same trap island entries avoid via this resolver.
			// (an href is markup: imported only from the page's code origins, as an island's own load)
			const url = code_url(island_module_url(href));
			if (url === null || seen.has(url)) continue;
			seen.add(url);
			void import_code(url).catch(() => {}); // ok: dev only: a region's own import says a failure; this one only styles early
		}
	}); // ok: dom_ready never rejects, and the work in it catches
}

export function boot(
	installers: Array<() => void> = [],
	client_plugins: readonly ClientRealm[] = []
): void {
	// which ogygia this page runs: `window.__ogygia.v` (./disclose-version.ts)
	disclose_version();
	// the runtime's rules, checked on itself (dev: after moves; e2e: `__ogygia_rules()`)
	if (RULES) install_rules(import.meta.env.DEV);
	// (The navigation handle island code reaches the runtime through is a feature now: `mpa-nav`
	// publishes the MPA one, the router's install replaces it — ./nav-handle.ts.)
	// The head the server sent is the page's (session.ts: who owns each node in <head>). No island
	// has woken yet — the runtime boots before any wake — so nothing here is an island's.
	runtime_session.adopt_document_head();
	// island-side code (a shim) throws and logs through the runtime's own messages (messages/island.ts)
	(globalThis as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.messages')] ??= {
		OgygiaError,
		warn,
		line
	};
	// What the lazy chunks use from the boot, handed over through the registry (./boot-link.ts).
	link_boot();
	for (const install of installers) install();
	// The build's location map, pinned to this page's address before any navigation moves it
	pin_build_map();
	// The origins island code may load from, read while the head is still the server's alone
	code_origins();
	// An island whose file was gone (this page outlived its build) woke on the current build's file:
	// the devtools timeline and the beacon hear it (entry-locations.ts imports neither)
	on_entry_fallback((report) => {
		if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'entry.fallback', ...report });
		if (HOOK_ENTRY_FALLBACK) slots.hooks?.entryFallback?.(report);
	});
	// A chunk whose dependency failed: no retry loads it, the page needs a reload (#262; said once,
	// import-again.ts imports nothing)
	on_reload_needed((url, error) =>
		console.error(new OgygiaError('chunk_reload_needed', { url }), error)
	);
	// The stylesheets an island file's load puts in the head are region sheets (#966)
	on_file_load(note_code_sheets);

	if (import.meta.env.DEV) apply_dev_head_region_css();

	// DEV: Svelte's hydration warnings (the server and the browser disagreed; Svelte kept the
	// server's value, so only the console knew) reach the devtools and the profiler's browser half
	if (import.meta.env.DEV) {
		tap_svelte_warnings();
		on_svelte_warning((w) => {
			if (HOOK_WARNING) slots.hooks?.warning?.(w);
			if (DEVTOOLS)
				dt_emit({
					domain: 'runtime',
					name: 'svelte.hydration.warning',
					code: w.code,
					message: w.message,
					...(w.file ? { file: w.file } : {}),
					...(w.fp ? { fp: w.fp } : {})
				});
		});
	}

	if (DEVTOOLS) {
		// Publish `window.__ogygia_devtools` so instruments + our own e2e can read the stream with no
		// app wiring — the default sink when the build compiled devtools in. (No-op off the browser.)
		dt_install_window_sink();
		// Fold the SERVER realm's events (the handle's `application/ogygia-devtools` side-channel) into
		// the same stream — a region's server render + client wake now share one fingerprint-keyed timeline.
		dt_ingest_server();
	}
	// The plugins' browser halves (`<plugin>/client`: the devtools dock and its leftovers watch), booted
	// before the first island wakes. Folds away with no plugin's client realm in the build.
	if (CLIENT_PLUGINS) boot_client_plugins(client_plugins, false);
	if (DEVTOOLS) {
		// Which optional features this per-app runtime shipped — the byte-ledger / boundary-lens read
		// this to know what's even possible on the page. Names come off each installer's slot presence.
		const features: string[] = [];
		if (slots.interaction) features.push('interaction');
		if (slots.morph) features.push('morph');
		// Hydrate-phase features (live / wire / remoteSeeds / context) install with the hydrate core,
		// after this boot report — they are listed once an island has hydrated.
		if (slots.frames) features.push('frames');
		if (slots.nav) features.push('router');
		if (slots.forms.enabled) features.push('forms');
		dt_emit({ domain: 'runtime', name: 'runtime.boot', features });
	}

	if (typeof customElements !== 'undefined' && !customElements.get('ogygia-region')) {
		customElements.define('ogygia-region', OgygiaRegion);
	}
}
