import {
	backoffAfter,
	buggify,
	clock,
	registry,
	STALE,
	tasks,
	type Fresh,
	type Mailbox,
	type Stale,
	type Turn
} from '@ogygia/machine';
import { plainFlights } from '@ogygia/machine';
import type { Life, Run } from '@ogygia/machine';
import { frameAddress, older_by, stands_at } from '../frame.ts';
import { is_media_query, on_trigger, WAKE } from '../contract/trigger.ts';
import { OG_FP, OG_HOLE, OG_KEPT, OG_STATIC, OGYGIA_REGION_CSS } from '../wire-markup.ts';
import { import_again, is_failed_import, on_file_load, on_reload_needed } from './import-again.ts';
import { browser_offline, no_response } from './network.ts';
import { HAS } from 'ogygia:boot';
import {
	answerParsed,
	answerPlaced,
	entryFallback,
	holeAnswered,
	holeFailed,
	realm_count,
	regionFailed,
	regionMount,
	regionUnmount,
	regionWoke,
	warning
} from 'ogygia:boot/hooks';
import {
	F_FORMS,
	F_FRAMES,
	F_GRAPH,
	F_IDLE,
	F_INTERACTION,
	F_LAKES,
	F_LIVE,
	F_MEDIA,
	F_MORPH,
	F_MPA_NAV,
	F_ROUTER,
	F_VISIBLE,
	F_WIRE_CLASSES
} from '../contract/features.ts';
import { wire_for_wake } from './wire-on-use.ts';
import { report_thrown } from '../report-thrown.ts';
import { kit_hydrates_page, publish_kit_hydrates } from './kit-boot.ts';
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
	OTHER_BUILD_DENIALS,
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
import type { LiveLink, LiveTick } from './live-program.ts';
import type { WakeLink } from './hydrate-core.ts';
import {
	frames,
	interaction,
	lakes,
	morph,
	mpa_nav,
	router,
	wire_classes
} from 'ogygia:boot/feature-code';
import { say_reload_needed } from './reload-needed.ts';
import {
	create_answer,
	create_hole,
	busy_machines,
	create_live,
	create_paint,
	create_region_life,
	create_wake,
	detached,
	new_lifetime,
	REGION_REST,
	type Answer,
	type Hole,
	type Live,
	type Paint,
	type RegionLife,
	type Wake
} from './region-machines.ts';
import { KEEP_FALLBACK_HTML } from '../keep-fallback-marker.ts';
import { download, region_fetch, region_other_build, region_rate_limited } from '../policies.ts';
import {
	install_rules,
	note_handed,
	note_left,
	note_mount,
	note_shown,
	note_turn,
	note_unbound,
	note_unmount,
	watch_programs
} from './rules.ts';
import { PAGE_FACTS_SELECTOR } from '../page-facts-script.ts';
import { linked } from './boot-link.ts';
import {
	background_start,
	hydrate_settled,
	hydrate_started,
	hydrate_turn,
	register_region,
	unregister_region,
	yield_task
} from './schedule.ts';
import { on_idle } from './arm-idle.ts';
import { on_visible } from './arm-visible.ts';
import { on_media } from './arm-media.ts';
import { say_trigger } from './schedule-said.ts';
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
import type { IslandHandle, IslandModule, WakeTimes } from './hydrate-core.ts';
import { emit as dt_emit } from '../events/bus.ts';
import {
	install_window_sink as dt_install_window_sink,
	ingest_server_events as dt_ingest_server
} from '../events/sinks.ts';
import { boot_client_plugins, type ClientRealm } from './client-plugins.ts';
import { client_region_mount } from './region-hooks.ts';
import { OgygiaError, warn, line } from '../messages/core.ts';
import { disclose_version } from './disclose-version.ts';

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);
const KIT_PAGES = typeof __OGYGIA_KIT_PAGES__ !== 'undefined' ? __OGYGIA_KIT_PAGES__ : true;
const FORMS_ON =
	typeof __OGYGIA_CONTINUITY_FORMS__ !== 'undefined' ? __OGYGIA_CONTINUITY_FORMS__ : true;

type SourceFrames = typeof import('./frames.ts');

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
const hydrate_core = plainFlights({
	name: 'hydrate core',
	run: () =>
		yield_task()
			.then(import_core)
			.then((m) => (loaded_core = linked(m))),
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
function arm_on_demand(region: Element, fire: () => void, owner: Life): void {
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
	if (HAS & F_GRAPH) preload_island_graph(entry, undefined, fetch_priority_of(cls));
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

type Leaves = Run;

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
function say_program_missing(entry: string, program: 'hole' | 'live'): void {
	console.error(new OgygiaError('region_program_missing', { entry, program }));
}
const nothing = (): void => {};
const kit_boot_failed = (err: unknown): boolean =>
	(err as { code?: unknown } | null)?.code === 'kit_boot_failed';

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
			Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'), (l) => [
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
				if (sheet.kind === 'loading') pending.push(until_settled(sheet));
				if (sheet.kind !== 'failed') {
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
							const wait = page.child();
							wait.later(resolve, 5000);
							// oxlint-disable-next-line ogygia/no-silent-failures -- every pending wait above resolves, failed or not
							void Promise.all(pending).then(() => {
								wait.close();
								resolve();
							});
						})
				)
				.then(() => undefined)
		: Promise.resolve();
	const parsed = answerParsed
		? (answerParsed({ fragment: frag }) as Promise<void> | undefined)
		: undefined;
	const keep_pristine = () => {
		for (const el of frag.querySelectorAll('ogygia-region')) {
			if (el.getAttribute('entry') && !is_deferred(el) && !is_frozen(el)) {
				(el as unknown as PristineHost)[PRISTINE_SSR] = el.innerHTML;
			}
		}
	};
	if (!parsed) {
		keep_pristine();
		return { frag, ready, sheets };
	}
	return { frag, ready: Promise.all([ready, parsed]).then(keep_pristine), sheets };
}

/** TEST: the pristine server markup {@link region_fragment} stashed on a nested island, if any. */
export function pristine_ssr_of(el: Element): string | undefined {
	return (el as unknown as PristineHost)[PRISTINE_SSR];
}

class OgygiaRegion extends HTMLElement {
	#region: RegionLife = create_region_life();
	#minted_endpoint: string | null = null;
	#ssr_html: string | null = null;
	get #life(): Life {
		return this.#region.data.life;
	}
	get #box(): Mailbox {
		return this.#region.data.box;
	}
	#shown: VerifiedHtml | null = null;
	#live_last: LiveTick | null = null;
	#asleep: Life | null = null;
	get #watching(): boolean {
		return this.#asleep !== null && !this.#asleep.closed;
	}
	#watch(): void {
		if (this.#watching) return;
		watch_region((this.#asleep = this.#life.child()), this);
	}
	#unwatch(): void {
		if (this.#asleep !== null) this.#asleep.close();
		this.#asleep = null;
	}
	#hole_run: Hole | null = null;
	get #hole(): Hole {
		return (this.#hole_run ??= create_hole());
	}
	#answer_run: Answer | null = null;
	get #answer(): Answer {
		return (this.#answer_run ??= create_answer());
	}
	#wake: Wake = create_wake();
	#fetch_started = 0;
	#frame_address: string | null = null;
	#binding: Life | null = null;
	#visitor: Promise<unknown> | null = null;
	#app: IslandHandle | null = null;
	#live_run: Live | null = null;
	get #live(): Live {
		return (this.#live_run ??= create_live());
	}
	#paint_run: Paint | null = null;
	get #paint(): Paint {
		return (this.#paint_run ??= create_paint());
	}
	#hydrate_run: { visit: number; run: Promise<void> } | null = null;
	#fire_hydrate = (): Promise<void> => {
		const held = this.#hydrate_run;
		if (held && (held.visit === this.#wake.epoch || this.#wake.kind === 'waking')) return held.run;
		const run = this.#box.ask((turn) => this.#hydrate(turn)).then(nothing);
		const entry = { visit: this.#wake.epoch, run };
		this.#hydrate_run = entry;
		const ran = () => this.#hydrate_ran(entry);
		run.then(ran, ran);
		return run;
	};
	#hydrate_ran(entry: { visit: number; run: Promise<void> }): void {
		if (this.#hydrate_run === entry) this.#hydrate_run = null;
	}
	#fire_server = () => this.#box.post((turn) => this.#server(turn));
	#fire_prefetch = () => this.#box.post(() => this.#prefetch_html());

	absorbKeptProps(next: Element): void {
		if (!this.#app?.set_props || !loaded_core) return;
		const sidecar = props_sidecar_of(next);
		const codec = wire_for_wake(next);
		if (this.#absorbing !== null) this.#absorbing.close();
		this.#absorbing = null;
		if (codec === undefined) return this.#absorb(sidecar);
		const waiting = (this.#absorbing = this.#life.child());
		waiting
			.task(() => codec)
			.then((loaded) => {
				if (loaded !== STALE) this.#absorb(sidecar);
			}, report_thrown);
	}
	#absorbing: Life | null = null;
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
		if (this.isConnected && this.#region.kind === 'detached') {
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
		if (this.hasAttribute('live'))
			return HAS & F_FRAMES && HAS & F_LIVE ? this.#live_put_back(turn) : undefined;
		if (HAS & F_FRAMES && this.#minted_endpoint === null && is_deferred(this)) {
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
		if (is_frozen(this) && (!(HAS & F_LAKES) || lakes.on_frozen_connect(this, this.#lake_arm())))
			return;
		if (this.#region.kind === 'scheduled') return;
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
		if (!deferred && HAS & F_LAKES && lakes.wait_for_boundary(this, boundary)) return;
		this.#region.move('connected', 'scheduled', this.#region.data);
		// A hole that had its answer, put back on the page: its schedule is spent (#336)
		if (HAS & F_FRAMES && deferred && this.#answer.kind !== 'none') {
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
			if (this.#wake.kind === 'cold') this.#wake.go('armed');
			this.#arm(when, this.#fire_hydrate);
			return;
		}
		if (!(HAS & F_FRAMES)) {
			say_program_missing(this.getAttribute('entry') || '', 'hole');
			return;
		}
		if (!this.#hole_armed()) return;
		this.#arm(when, this.#fire_server);
		const prefetch = this.getAttribute('prefetch');
		if (prefetch && prefetch !== when && prefetch !== 'interaction') {
			this.#arm(prefetch, this.#fire_prefetch);
		}
	}

	#hole_armed(): boolean {
		const s = this.#hole.now;
		if (s.kind === 'armed') return true;
		if (s.kind === 'fetching') return false;
		return s.kind === 'retrying'
			? this.#hole.go('armed', { attempts: s.attempts, denied: s.denied })
			: this.#hole.go('armed', { attempts: 0, denied: 0 });
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
		if (!replayed && shown !== null && this.#answer.kind === 'answered')
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
		if (!(HAS & F_FRAMES)) return;
		if (this.#answer.kind !== 'none' || this.#hole.kind === 'fetching' || !this.isConnected) return;
		const endpoint = this.#endpoint();
		if (!endpoint || !is_allowed_region_endpoint(endpoint)) return;
		const address = frameAddress(endpoint);
		if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'region.prefetch', ...dt_ids(this) });
		// oxlint-disable-next-line ogygia/no-silent-failures -- a warm ahead; the hole's own fetch asks again and says its failure
		void (frames as unknown as SourceFrames)
			.ensure(address, this.#frame_fetcher(endpoint, false, 'ahead'), {
				priority: PRIORITY.ahead
			})
			.catch(() => {});
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
			renewed: (fresh) => frames.renew(address, fresh)
		});
	}

	#lake_arm() {
		return {
			idle:
				HAS & F_IDLE
					? (fire: () => void) => {
							if (this.#hole_armed()) on_idle(fire, this.#hole);
						}
					: null,
			visible:
				HAS & F_VISIBLE
					? (fire: () => void, margin?: string) => {
							if (this.#hole_armed()) on_visible(this, fire, margin, this.#hole);
						}
					: null,
			media:
				HAS & F_MEDIA
					? (when: string, fire: () => void) =>
							is_media_query(when) && (!this.#hole_armed() || on_media(when, fire, this.#hole))
					: null,
			fetch_revalidate: () => this.#box.post((turn) => this.#fetch_html(turn, true)),
			wake_children: () => this.#wake_waiting_regions()
		};
	}

	#arm(when: string, fire: () => unknown, visible_margin?: string) {
		const owner: Leaves = fire === this.#fire_hydrate ? this.#wake : this.#hole;
		if (fire === this.#fire_hydrate && when !== 'interaction') this.#catch_early_input(fire);
		if (DEVTOOLS || regionWoke) {
			const raw = fire;
			fire = () => {
				if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'wake.fired', ...dt_ids(this), when });
				if (regionWoke) regionWoke({ el: this, when });
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
		const armed = owner.visit();
		const start = () => background_start(() => void (armed.closed || fire()));
		const said = on_trigger(
			when,
			WAKE,
			{
				idle: HAS & F_IDLE ? (f) => on_idle(f, owner) : null,
				visible: HAS & F_VISIBLE ? () => on_visible(this, start, visible_margin, owner) : null,
				load: start,
				media: HAS & F_MEDIA ? (value) => on_media(value, start, owner) : null,
				interaction: (f) => {
					if (HAS & F_FRAMES && owner === this.#hole) {
						arm_on_demand(
							this,
							() => {
								this.#visitor = NO_REPLAY; // (a hole's answer: nothing of the visitor's to replay)
								return f();
							},
							owner.visit()
						);
					} else this.#on_interaction(f);
				}
			},
			fire
		);
		if (said) say_trigger(this, when, said);
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
		if (KIT_PAGES && kit_hydrates_page() && !ours_on_kit_document(this)) {
			this.setAttribute('data-kit-hydrated', '');
			return;
		}
		if (!(HAS & F_INTERACTION)) {
			fire();
			return;
		}
		this.#hold_capture(interaction.arm(this, this.#by_visitor(fire), this.#life));
	}

	/**
	 * A scheduled island (`load` / `idle` / `visible` / media) also catches input until it is live — the
	 * interaction capture, armed beside its schedule: the first press, key or focus on it wakes it now,
	 * as a gesture, and a click is replayed once it is live. Not on a Kit-hydrated page (Kit owns the
	 * island there, as for `interaction`), not without the interaction feature, never once awake.
	 */
	#catch_early_input(fire: () => unknown) {
		if (!(HAS & F_INTERACTION) || this.#app) return;
		if (KIT_PAGES && kit_hydrates_page() && !ours_on_kit_document(this)) return;
		this.#hold_capture(interaction.arm(this, this.#by_visitor(fire), this.#life));
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
			if (wake.kind === 'waking') wake.visit().defer(hold);
			else disarm(!this.isConnected);
		};
		wake.visit().defer(hold);
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
		const fresh = HAS & F_FRAMES && address ? frames.renewal(address) : null;
		const current = this.getAttribute('endpoint');
		if (!fresh || fresh === current || (current && !capability_expired(current))) return;
		this.#minted_endpoint = fresh;
		this.setAttribute('endpoint', fresh);
		if (this.#bound()) this.#bind(fresh);
	}

	#bind(endpoint: string): boolean {
		if (!(HAS & F_FRAMES)) return false;
		const address = frameAddress(endpoint);
		if (this.#bound() && this.#frame_address === address) return false;
		if (this.#hole.kind === 'fetching') this.#hole.go('idle');
		if (this.#binding !== null) this.#binding.close();
		const binding = (this.#binding = this.#life.child());
		this.#frame_address = address;
		binding.defer(() => {
			if (this.#binding === binding) this.#frame_address = null;
			note_unbound(this);
		});
		const box = this.#box;
		let replayed = false;
		// @why the app's build keeps a namespace import bound to a const as an object, one more boot file (test: apps/palaestra/e2e/lazy-chunks.spec.ts › boot fetches neither; the first wake fetches the hydrate core, the first hover the navigation)
		const off = (frames as unknown as SourceFrames).subscribe(address, (f) => {
			replayed = true;
			note_handed(this, address, f.v, () => this.#paint.kind === 'painting');
			box.post((turn) => {
				note_turn(this);
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
		if (!(HAS & F_FRAMES)) return;
		const endpoint = this.#endpoint();
		const replayed = endpoint ? this.#bind(endpoint) : false;
		const run = replayed ? undefined : this.#fetch_html(turn);
		if (this.#hole.kind === 'armed') this.#hole.go('idle');
		return run;
	}

	/**
	 * A deferred client island's answer is in: arm its phase-2 wake — coalescing a schedule that
	 * matches the hole's own `when` to an immediate load. Once: an island already armed, waking, awake
	 * or failed is not armed again (a refresh morphs a live island in place).
	 */
	#arm_phase2(): void {
		if (this.#wake.kind !== 'cold' || this.#app || !this.isConnected) return;
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
		this.#answer.go(kind === 'kept' ? 'kept' : 'answered');
		const hole = this.#hole.kind;
		if (hole === 'armed' || hole === 'retrying' || hole === 'offline' || hole === 'failed')
			this.#hole.go('idle');
	}

	#paint_next(): number {
		this.#paint.go('painting');
		return this.#paint.epoch;
	}

	#painted(painting: number): void {
		if (this.#paint.epoch === painting) this.#paint.go('idle');
	}

	async #apply(html: VerifiedHtml, turn: Turn, v?: number) {
		if (!this.isConnected) return;
		const painting = this.#paint_next();
		if (html === KEEP_FALLBACK_HTML) {
			this.#painted(painting);
			if (v !== undefined) note_shown(this, v);
			use_sheets(this, []); // (the fallback's sheets are the page's)
			this.#answered('kept');
			if (!is_awake(this)) this.setAttribute('data-hydrated', '');
			this.setAttribute(OG_KEPT, '');
			this.#adopt_renewed();
			this.dispatchEvent(new CustomEvent('ogygia:server', { bubbles: true }));
			return;
		}
		const revalidate = is_frozen(this) || this.#answer.kind === 'answered';
		const { frag, ready, sheets } = region_fragment(html);
		$await(turn.wait(ready));
		if (this.#paint.epoch !== painting) return;
		this.#painted(painting);
		if (v !== undefined) note_shown(this, v);
		use_sheets(this, sheets);
		this.#shown = html;
		if (HAS & F_LAKES) {
			lakes.settle_in(frag);
			lakes.mark_frozen_settled(this);
		}
		if (!this.#app && region_hydrate_schedule(this)) {
			this.#ssr_html = fragment_markup(frag);
			this.#watch();
		}
		if (HAS & F_MORPH) morph.morph_children(this, Array.from(frag.childNodes));
		else this.replaceChildren(frag);
		if (answerPlaced) answerPlaced({ el: this });
		init_shadow_registries(this);
		absorb_page_facts_now();
		this.#answered('answered');
		this.removeAttribute(OG_KEPT);
		if (revalidate) this.setAttribute('data-revalidated', '');
		else if (!is_awake(this)) this.setAttribute('data-hydrated', '');
		if (HAS & F_LAKES)
			lakes.after_html_swap(this, { revalidate }, () => this.#wake_waiting_regions());
		if (holeAnswered && !revalidate && this.#fetch_started) {
			const ep = this.getAttribute('endpoint');
			const batch = HAS & F_FRAMES && ep ? frames.batch_times(ep) : undefined;
			holeAnswered({
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
				...(!revalidate && this.#fetch_started
					? { wait_ms: Math.round(clock.mono() - this.#fetch_started) }
					: {})
			});
		this.#adopt_renewed();
		this.dispatchEvent(new CustomEvent('ogygia:server', { bubbles: true }));
		this.#arm_phase2();
	}

	#renew(turn: Turn): Promise<void> | undefined {
		if (!this.#frame_address || !is_deferred(this)) return;
		const endpoint = this.getAttribute('endpoint');
		if (!endpoint || frameAddress(endpoint) === this.#frame_address) return;
		return this.#fetch_html(turn, true);
	}

	async #fetch_html(turn: Turn, revalidate = false): Promise<void> {
		if (!(HAS & F_FRAMES)) return;
		if (!revalidate && this.#answer.kind !== 'none') return;
		const endpoint = this.#endpoint();
		if (!endpoint) return;
		if (this.#hole.kind === 'fetching' && frameAddress(endpoint) === this.#frame_address) return;
		if (!is_allowed_region_endpoint(endpoint)) {
			if (import.meta.env.DEV) {
				warn('region_endpoint_foreign', { endpoint });
			}
			return;
		}
		if (!this.#fetch_started) this.#fetch_started = clock.mono();
		this.#bind(endpoint);
		const address = frameAddress(endpoint);
		const s = this.#hole.now;
		const before = s.kind === 'armed' || s.kind === 'retrying' ? s : { attempts: 0, denied: 0 };
		const { attempts, denied } = before;
		this.#hole.go('fetching', { attempts, denied, revalidate });
		const mine = this.#hole.epoch;
		try {
			if (RULES && buggify.fires('hole.fetch-lost')) throw new TypeError('Failed to fetch');
			$await(
				turn.wait(
					this.#hole
						.visit()
						.task((signal) => this.#ensure_frame(endpoint, address, revalidate, signal))
				)
			);
		} catch (err) {
			if (this.#hole.epoch !== mine) return;
			return this.#fetch_failed(turn, err, endpoint, revalidate, attempts + 1, denied);
		}
		if (this.#hole.epoch === mine) this.#hole.go('idle');
	}

	async #ensure_frame(
		endpoint: string,
		address: string,
		revalidate: boolean,
		signal: AbortSignal
	): Promise<string | Stale> {
		if (!revalidate && !endpoint.includes('&ttl=') && !capability_expired(endpoint))
			await frames.join_batch(endpoint);
		const cls = () => (this.#visitor ? 'user' : viewport_class(this));
		const fetcher = this.#frame_fetcher(endpoint, revalidate, cls);
		return (frames as unknown as SourceFrames).ensure(address, fetcher, {
			force: revalidate,
			signal,
			priority: PRIORITY[cls()]
		});
	}

	async #fetch_failed(
		turn: Turn,
		err: unknown,
		endpoint: string,
		revalidate: boolean,
		attempts: number,
		denied_before: number
	): Promise<void> {
		const refused = err instanceof RegionAnswerRefused;
		const deny = refused && err.reason === 'forbidden' ? err.deny || 'no reason given' : undefined;
		const other_build = deny !== undefined && OTHER_BUILD_DENIALS.has(deny.split(':', 1)[0]);
		const denied = other_build ? denied_before + 1 : denied_before;
		const out_of_tries = other_build
			? denied >= region_other_build.attempts
			: attempts >= region_fetch.attempts;
		const offline = !refused && this.isConnected && no_response(err) && browser_offline();
		const final = !offline && ((refused && !other_build) || !this.isConnected || out_of_tries);
		if (final || (import.meta.env.DEV && !other_build)) {
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
		if (holeFailed && final) {
			let id = '';
			let final_path: string | undefined;
			try {
				id = new URL(endpoint, location.href).searchParams.get('id') ?? '';
				if (refused) final_path = new URL(err.final_url, location.href).pathname;
				// oxlint-disable-next-line ogygia/no-silent-failures -- an endpoint URL that was fetched parses; the message goes without its id if not
			} catch {}
			if (id)
				holeFailed({
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
		this.#region.move('scheduled', 'connected', this.#region.data);
		if (!final) {
			if (this.#answer.kind !== 'none') {
				this.#hole.go('idle');
				return;
			}
			if (offline) {
				this.#hole.go('offline', { revalidate });
				const waiting = this.#hole.visit();
				$await(
					turn.wait(
						waiting.task(
							() =>
								new Promise<void>((resolve) => waiting.listen(window, 'online', () => resolve()))
						)
					)
				);
				if (revalidate) return this.#fetch_html(turn, true);
				return this.#connect(turn);
			}
			this.#hole.go('retrying', { attempts, denied, revalidate });
			const retrying = this.#hole.visit();
			const later = err instanceof RegionAnswerLater ? err.wait_ms : null;
			let wait: number;
			if (later !== null) wait = Math.min(later, backoffAfter(region_rate_limited, attempts));
			else if (other_build) wait = backoffAfter(region_other_build, denied);
			else wait = backoffAfter(region_fetch, attempts);
			$await(
				turn.wait(
					retrying.task(() => new Promise<void>((resolve) => retrying.later(resolve, wait)))
				)
			);
			if (revalidate) return this.#fetch_html(turn, true);
			return this.#connect(turn);
		}
		this.#hole.go('failed');
		if (HAS & F_LAKES)
			lakes.after_fetch_exhausted(this, { revalidate }, () => this.#wake_waiting_regions());
	}

	#wake_waiting_regions() {
		for (const el of this.querySelectorAll('ogygia-region')) {
			if (el instanceof OgygiaRegion) el.connectedCallback();
		}
	}

	async #hydrate(held: Turn) {
		const from = this.#wake.kind;
		if (this.#app || (from !== 'cold' && from !== 'armed')) return;
		this.#wake.go('waking');
		const mine = this.#wake.epoch;
		const visit = this.#wake.visit();
		const probe = (s: string) =>
			this.setAttribute('data-probe', `${this.getAttribute('data-probe') ?? ''} ${s}`);
		let wn = 0;
		const turn = {
			wait: <T>(work: PromiseLike<T> | T): Promise<Fresh<T> | Stale> => {
				const n = ++wn;
				probe(`w${n}`);
				Promise.resolve(work).then(
					() => probe(`w${n}ok`),
					() => probe(`w${n}err`)
				);
				const tasked = visit.task(() => work);
				tasked.then(
					(v) => probe(`w${n}task${v === STALE ? 'STALE' : ''}`),
					() => probe(`w${n}taskerr`)
				);
				return held.wait(tasked).then(
					(v) => {
						probe(`w${n}back${v === STALE ? 'STALE' : ''}${this.isConnected ? '' : 'GONE'}`);
						return this.isConnected ? (v as Fresh<T> | Stale) : STALE;
					},
					(e: unknown) => {
						probe(`w${n}backerr`);
						throw e;
					}
				);
			}
		};
		(this as unknown as { __probe: typeof probe }).__probe = probe;
		let failure: { error: unknown } | null = null;
		let offline: { error: unknown } | null = null;
		const t0 = now_ms();
		const times: WakeTimes = { t0, loaded: t0, turn: undefined };
		if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'region.hydrate.start', ...dt_ids(this) });
		if (regionMount) client_region_mount(this);
		try {
			// wait for full parse so the end-of-body props sidecars (and the seed) are in the DOM. On an
			// SPA swap (and any post-load hydrate) the document is already parsed, so skip the await
			// entirely — no need to burn a microtask turn before every island wakes.
			if (typeof document !== 'undefined' && document.readyState === 'loading') {
				$await(turn.wait(dom_ready()));
			} else if (!this.isConnected) return;
			const entry = island_entry_of(this);
			if (!entry) return;
			const cls = () => (this.#visitor ? 'user' : viewport_class(this));
			const slot = new LoadSlot({ kind: 'code', cls, label: entry, el: this });
			// (gone while it queued: the slot, when it comes, goes straight back)
			// oxlint-disable-next-line ogygia/no-silent-failures -- a slot's turn never fails
			const release = $await(turn.wait(slot.ready), void slot.ready.then(hand_back));
			let mod: IslandModule, core: HydrateCore;
			try {
				hydrate_started(this); // a viewport island in flight holds ready islands below the fold
				// The island's module first: its graph links go in before the lazy runtime chunks' own preloads.
				const parts = [
					load_island(entry, cls()),
					hydrate_core.get(),
					HAS & F_WIRE_CLASSES ? wire_classes.wire_classes_for(this) : null,
					wire_for_wake(this),
					devalue_for_wake()
				] as const;
				parts.forEach((p, i) =>
					Promise.resolve(p).then(
						() => probe(`p${i}ok`),
						() => probe(`p${i}err`)
					)
				);
				const loaded = $await(
					turn.wait(
						Promise.all([
							Promise.resolve(parts[0]),
							Promise.resolve(parts[1]),
							Promise.resolve(parts[2]),
							Promise.resolve(parts[3]),
							Promise.resolve(parts[4])
						])
					)
				);
				[mod, core] = loaded;
			} finally {
				release();
			}
			times.loaded = now_ms();
			const wake = (OgygiaRegion.#wake_given ??= OgygiaRegion.#wake_link());
			await core.wake_island(this, entry, mod, visit, turn, times, wake);
		} catch (err) {
			// A run whose visit is over fails quietly: the region left while it loaded, and what stands
			// now (the region put back) is a new visit, which loads, fails or wakes on its own.
			if (this.#wake.epoch !== mine) return;
			if (is_failed_import(err) && browser_offline()) {
				offline = { error: err };
				return;
			}
			failure = { error: err };
			// (a failed island stops being watched; its copy, if kept, counts as changed from here)
			if (this.#watching) mark_region_changed(this);
			this.#unwatch();
			if (regionFailed)
				regionFailed({
					el: this,
					message: (err as { message?: string })?.message ?? String(err),
					since: t0,
					turn: times.turn
				});
			if (DEVTOOLS)
				dt_emit({
					domain: 'runtime',
					name: 'region.hydrate.failed',
					...dt_ids(this),
					message: (err as { message?: string })?.message ?? String(err),
					...(times.turn !== undefined ? { turn: times.turn } : {})
				});
			say_island_failed(this.getAttribute('entry'), err);
		} finally {
			// live (or failed, or not ours): leaving `waking` disarms the capture — its clicks are its own
			// from here (a click it already queued is still replayed by the wake that queued it). Not
			// when the visit is over already: the region left the page, and its teardown moved it and
			// took it out of the scheduler (the scheduler's mark, if any, is the new visit's).
			if (this.#wake.epoch === mine) {
				hydrate_settled(this);
				if (failure) this.#wake.go('failed', failure);
				else if (offline) this.#wake_online(offline.error);
				else this.#wake.go(this.#app ? 'awake' : 'cold');
			}
		}
	}

	#wake_online(error: unknown): void {
		this.#wake.go('offline', { error });
		this.#wake.visit().listen(window, 'online', () => {
			this.#wake.go('armed');
			// oxlint-disable-next-line ogygia/no-silent-failures -- a wake; its hydrate says its own failure
			void this.#fire_hydrate();
		});
	}

	/**
	 * Apply a live region tick (called by Region.svelte for a deferred region whose ticket
	 * carries server-rendered HTML).
	 *
	 * - **First tick:** parse + swap the HTML in. Interactive (`hydrate` + `module`) → hydrate a
	 *   pushable props so later ticks can push them. Static → done (no JS ever ships).
	 * - **Later tick, same interactive module:** keep-alive — push the new props to the mounted
	 *   component (focus + local state survive; Svelte reconciles). No swap, no re-hydrate.
	 * - **Later tick, static:** morph the new HTML in place (see {@link morph_children}).
	 * - **Later tick, module changed:** unmount, swap, re-hydrate.
	 */
	async applyLive(desc: LiveTick): Promise<void> {
		if (!(HAS & F_FRAMES) || !(HAS & F_LIVE)) return say_program_missing(desc.id, 'live');
		this.#live_last = desc;
		$await(this.#box.ask((turn) => this.#apply_live(desc, turn)));
	}

	#live_put_back(turn: Turn): Promise<void> | undefined {
		const last = this.#live_last;
		if (last === null || this.#live.kind !== 'idle') return;
		return this.#apply_live(last, turn);
	}

	async #apply_live(desc: LiveTick, turn: Turn): Promise<void> {
		if (HAS & F_FRAMES && desc.url && !(desc.hydrate && desc.module))
			desc.written ??= { v: frames.ticket(frameAddress(desc.url)) };
		let core = loaded_core;
		if (core === null)
			try {
				core = $await(turn.wait(hydrate_core.get()));
			} catch (error) {
				say_island_failed(this.getAttribute('entry'), error);
				return;
			}
		const live = (OgygiaRegion.#live_given ??= OgygiaRegion.#live_link());
		return core.apply_live?.(this, desc, turn, live);
	}

	static #wake_given: WakeLink | null = null;
	static #live_given: LiveLink | null = null;

	static #wake_link(): WakeLink {
		return {
			visitor: (el) => (el as OgygiaRegion).#visitor,
			app: (el) => (el as OgygiaRegion).#app,
			ssr_html: (el) => (el as OgygiaRegion).#ssr_html,
			hydrated: (el, app) => {
				const r = el as OgygiaRegion;
				r.#app = app;
				r.#ssr_html = null;
				r.#unwatch();
			},
			use_code_sheets,
			hydrate_turn,
			region_changed,
			hydrating: (el) => {
				set_hydrating(el, (el as OgygiaRegion).#life);
			},
			mounted: (el) => {
				note_mount(el);
			}
		};
	}

	static #live_link(): LiveLink {
		return {
			live: (el) => (el as OgygiaRegion).#live,
			paint: (el) => (el as OgygiaRegion).#paint,
			box: (el) => (el as OgygiaRegion).#box,
			renew: (el) => {
				if (el instanceof OgygiaRegion) el.#box.post((t) => el.#renew(t));
			},
			region_fragment,
			settle_in: (frag) => {
				if (HAS & F_LAKES) lakes.settle_in(frag);
			},
			absorb_page_facts_now,
			use_sheets,
			use_code_sheets,
			init_shadow_registries,
			vouch_remote_answer,
			frameAddress,
			older_by,
			stands_at,
			island_entry_of,
			viewport_class,
			LoadSlot,
			load_island,
			hydrate_core: () => hydrate_core.get(),
			devalue_for_wake,
			dom_ready,
			kit_boot_failed,
			say_island_failed,
			client_region_mount: regionMount ? client_region_mount : nothing
		};
	}

	disconnectedCallback() {
		tasks.micro(() => {
			if (!this.isConnected && this.#region.kind !== 'detached') this.#teardown();
		});
	}

	#teardown() {
		unregister_region(this);
		// out of the document nothing watches it: a copy it keeps is compared if it wakes again (its
		// sleep ends with its lifetime, below)
		if (this.#watching) mark_region_changed(this);
		if (regionUnmount && this.#app)
			regionUnmount({ el: this, entry: this.getAttribute('entry') ?? '' });
		const live = this.#live_run;
		if (live !== null && live.kind !== 'idle') live.go('idle');
		const hole = this.#hole_run;
		if (hole !== null && hole.kind !== 'idle') hole.go('idle');
		if (this.#wake.kind !== 'cold') this.#wake.go('cold');
		const paint = this.#paint_run;
		if (paint !== null && paint.kind !== 'idle') paint.go('idle');
		note_left(this, () =>
			busy_machines({
				hole: this.#hole_run?.kind ?? REGION_REST.hole,
				wake: this.#wake.kind,
				'live-region': this.#live_run?.kind ?? REGION_REST['live-region'],
				'region-paint': this.#paint_run?.kind ?? REGION_REST['region-paint']
			})
		);
		this.#life.close();
		this.#region.go('detached', detached());
		if (this.#app) {
			this.#app.dispose();
			this.#app = null;
			note_unmount(this);
		}
	}
}

const apply_dev_head_region_css: () => void = $dev(function apply_dev_head_region_css(): void {
	if (typeof document === 'undefined') return;
	// oxlint-disable-next-line ogygia/no-silent-failures -- dom_ready never rejects, and the work in it catches
	void dom_ready().then(() => {
		const seen = new Set<string>();
		for (const link of document.querySelectorAll(`link[${OGYGIA_REGION_CSS}]`)) {
			const href = link.getAttribute('href');
			if (!href || CSS_ASSET_HREF_RE.test(href)) continue;
			link.remove();
			const url = code_url(island_module_url(href));
			if (url === null || seen.has(url)) continue;
			seen.add(url);
			// oxlint-disable-next-line ogygia/no-silent-failures -- dev only: a region's own import says a failure; this one only styles early
			void import_code(url).catch(() => {});
		}
	});
});

/** Boot the runtime: its features' installs (`ogygia:boot/feature-code`, those the build's word
 *  holds), then the region element. Idempotent. */
export function boot(client_plugins: readonly ClientRealm[] = []): void {
	disclose_version();
	if (!publish_kit_hydrates()) return;
	install_rules(import.meta.env.DEV);
	watch_programs(HAS);
	runtime_session.adopt_document_head();
	// island-side code (a shim) throws and logs through the runtime's own messages (messages/island.ts)
	(globalThis as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.messages')] ??= {
		OgygiaError,
		warn,
		line
	};
	if (HAS & F_FRAMES) frames.install();
	if (HAS & F_MPA_NAV) mpa_nav.install();
	if (HAS & F_ROUTER) router.install();
	// The build's location map, pinned to this page's address before any navigation moves it
	pin_build_map();
	// The origins island code may load from, read while the head is still the server's alone
	code_origins();
	on_entry_fallback((report) => {
		if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'entry.fallback', ...report });
		if (entryFallback) entryFallback(report);
	});
	// A chunk whose dependency failed: no retry loads it, the page needs a reload (#262; said once,
	// import-again.ts imports nothing)
	on_reload_needed(say_reload_needed);
	on_file_load(note_code_sheets);

	apply_dev_head_region_css();

	// DEV: Svelte's hydration warnings (the server and the browser disagreed; Svelte kept the
	// server's value, so only the console knew) reach the devtools and the profiler's browser half
	if (import.meta.env.DEV) {
		tap_svelte_warnings();
		on_svelte_warning((w) => {
			if (warning) warning(w);
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
		dt_install_window_sink();
		dt_ingest_server();
	}
	if (realm_count) boot_client_plugins(client_plugins, false);
	if (DEVTOOLS) {
		const features: string[] = [];
		if (HAS & F_INTERACTION) features.push('interaction');
		if (HAS & F_MORPH) features.push('morph');
		if (HAS & F_FRAMES) features.push('frames');
		if (HAS & F_ROUTER) features.push('router');
		if (HAS & F_FORMS && FORMS_ON) features.push('forms');
		dt_emit({ domain: 'runtime', name: 'runtime.boot', features });
	}

	if (typeof customElements !== 'undefined' && !customElements.get('ogygia-region')) {
		customElements.define('ogygia-region', OgygiaRegion);
	}
}
