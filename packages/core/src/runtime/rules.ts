/**
 * THE RUNTIME'S RULES (#313, ../rules.ts): what is always true of a page, checked in dev a task
 * after machine moves (a navigation is the navigation machine's) and by e2e at the end of a test.
 *
 * - `rule_region_mounted_twice`: one mount per region. A region element holds one island at a time,
 *   and an island whose element left the page is let go with it.
 * - `rule_address_bar_drift`: the entry the address bar is on is the router's history model's page
 *   on screen once no navigation is out (its address is the bar's: ./router.ts `RouterHistory`).
 * - `rule_old_page_open`: nothing of a page that was left is still open (its visit's scope closed:
 *   its listeners, timers, streams).
 * - `rule_failure_uncoded`: no failure leaves ogygia without a code: an uncaught ogygia error names
 *   its code's page, nothing thrown in ogygia's own code escapes uncoded (a plain TypeError), and a
 *   `STALE` never escapes as a rejection.
 * - `rule_parse_upgraded`: a parsed answer is inert (./html-sink.ts, #382): no element of it was
 *   built by a component's constructor before the restore reached it.
 * - `rule_markup_known`: every ogygia marker on the page (`data-ogygia-*`, and `data-og-*` on an
 *   `ogygia-*` element) is declared in `MARK` (../wire-markup.ts, #479): a renamed or misspelled
 *   marker is caught, not read as missing. An app's own `data-og-*` is left alone.
 * - `rule_region_answer_behind`: a region bound to a frame-store address shows the answer the
 *   address holds (./frame-store.ts tickets): it was handed the newest, and painted it once no paint
 *   is out.
 * - `rule_region_left_busy`: a region element that left the page has every machine at rest (its
 *   hole's fetch, its wake, its live mode, its paint): no visit of it waits on what can no longer
 *   happen (#1132). Read from a task after its teardown.
 * - `rule_lake_restored`: an island's hydrate keeps every lake it held (./lakes.ts `release` finds
 *   them by lake key, its identity and place: a lake not found again loses its content).
 * - `rule_head_adopted`: the head never gains a `<base>` or a refresh / CSP / cookie meta after the
 *   first document (SPA-HEAD, ./head-deny.ts).
 * - `rule_turns_counted`: the hydration scheduler's count of pending turns is the turns it holds,
 *   each in the heap its snapshot names (./schedule.ts `turns_counted`: the drain's pick rests on it).
 * - `rule_seed_key_unshipped`: island code reads no `page.data` key the server had and the shaped
 *   page seed left out (seed shaping, `pageKeys()`; the seed names what it left out in rules builds).
 *
 * Each area tells this module what it holds (`note_mount`, `note_visit`, `watch_router`) only when
 * rules are on (`RULES`): every call site folds out of a build without them.
 */
import { observe, STALE, timers, trace } from '@ogygia/machine';
import { Rules, type BrokenRule } from '../rules.ts';
import { warn } from '../messages/core.ts';
import type { PageGlobals } from '../page-globals.ts';
import { OG_PREFIX, OGYGIA_PREFIX, unknown_markers } from '../wire-markup.ts';

type RuntimeRule =
	| 'rule_region_mounted_twice'
	| 'rule_address_bar_drift'
	| 'rule_old_page_open'
	| 'rule_failure_uncoded'
	| 'rule_parse_upgraded'
	| 'rule_markup_known'
	| 'rule_region_answer_behind'
	| 'rule_region_left_busy'
	| 'rule_head_adopted'
	| 'rule_lake_restored'
	| 'rule_turns_counted'
	| 'rule_seed_key_unshipped';

/** The runtime's rules. */
export const runtime_rules: Rules<RuntimeRule> = /* @__PURE__ */ new Rules<RuntimeRule>();

// ── one mount per region ──

/** What the runtime's rules track while they are on (dev, a rules build): the region elements
 *  that hold an island now and how many (each leaves at its unmount), the page visits made (each
 *  leaves once closed, at the next check), the regions that left the page and are not yet seen at
 *  rest (each leaves once it is, or is back), the regions bound to a frame-store address now (each
 *  leaves when it lets its address go), and the few breaks found so far (10 each, at most). */
class RuleRows {
	readonly mounts = new Map<Element, number>();
	readonly shows = new Map<Element, Shows>();
	readonly left = new Map<Element, () => readonly string[]>();
	readonly visits: Array<{ visit: Visit; n: number }> = [];
	readonly uncoded: string[] = [];
	readonly parsed_built: string[] = [];
	readonly unshipped_reads: string[] = [];
	readonly lakes_unpaired: string[] = [];
}
const R = new RuleRows();

/** A region element mounted its island. */
export function note_mount(region: Element): void {
	R.mounts.set(region, (R.mounts.get(region) ?? 0) + 1);
}

/** A region element let its island go. */
export function note_unmount(region: Element): void {
	const n = (R.mounts.get(region) ?? 0) - 1;
	if (n > 0) R.mounts.set(region, n);
	else R.mounts.delete(region);
}

const entry_of = (region: Element): string => region.getAttribute('entry') ?? region.tagName;

function one_mount_per_region(): string | null {
	for (const [region, n] of R.mounts) {
		if (n > 1) return `${entry_of(region)} holds ${n} islands at once`;
		// (a region moved within one task is still the page's: its teardown waits a microtask, and a
		// check runs a task after the moves)
		if (!region.isConnected)
			return `${entry_of(region)} left the page with its island still mounted`;
	}
	return null;
}

// ── a region that left the page is at rest ──

/** A region element left the page (its teardown ran): `busy` reads its machines not at rest, as
 *  `name state` (./region-machines.ts `busy_machines`). */
export function note_left(region: Element, busy: () => readonly string[]): void {
	R.left.set(region, busy);
}

function regions_left_at_rest(): string | null {
	for (const [region, read_busy] of R.left) {
		// (put back: its machines are the page's again)
		if (region.isConnected) {
			R.left.delete(region);
			continue;
		}
		const busy = read_busy();
		if (busy.length === 0) {
			R.left.delete(region);
			continue;
		}
		return `${entry_of(region)} left the page with ${busy.join(', ')}`;
	}
	return null;
}

// ── every marker on the page is declared ──

/** The page's markers that `MARK` (../wire-markup.ts) does not declare: any `data-ogygia-*` (that
 *  namespace is ogygia's), and a `data-og-*` on an `ogygia-*` element. `data-og-` elsewhere may be
 *  the app's own (Open Graph tooling, say); ogygia's spellings of it are held to `MARK` by
 *  test/wire-markup.test.ts, which reads the sources. */
function markup_known(): string | null {
	if (typeof document === 'undefined') return null;
	const names = new Set<string>(); // (one per check)
	for (const el of document.querySelectorAll('*')) {
		const own = el.localName.startsWith('ogygia-');
		for (const name of el.getAttributeNames())
			if (name.startsWith(OGYGIA_PREFIX) || (own && name.startsWith(OG_PREFIX))) names.add(name);
	}
	const unknown = unknown_markers(names);
	return unknown.length ? `the page carries undeclared markers: ${unknown.join(', ')}` : null;
}

// ── nothing of an old page still open ──

type Visit = { readonly scope: { readonly closed: boolean } };

/** (Each visit made, in the order made, is in `R.visits`: one older than the page on screen's is over.) */
let visit_n = 0;
let current: Visit | null = null;

/** A page visit was made (`current`: it is the page on screen's now). */
export function note_visit(visit: Visit, is_current: boolean): void {
	if (!R.visits.some((v) => v.visit === visit)) R.visits.push({ visit, n: ++visit_n });
	if (is_current) current = visit;
}

function no_old_page_open(): string | null {
	const now = R.visits.find((v) => v.visit === current);
	if (now === undefined) return null;
	for (let i = R.visits.length - 1; i >= 0; i--)
		if (R.visits[i].visit.scope.closed) R.visits.splice(i, 1);
	const open = R.visits.filter((v) => v.n < now.n).length;
	return open === 0 ? null : `${open} page visit(s) before the one on screen still open`;
}

// ── the address bar, the history model, the page ──

/** What the rule reads of the router: its navigation, and its history model's page on screen. */
interface RouterView {
	readonly nav: { readonly now: { readonly kind: string } };
	readonly history: { readonly current: { readonly id: string } };
}

/** The router started: its history model is checked against the address bar. */
export function watch_router(router: RouterView): void {
	runtime_rules.add('rule_address_bar_drift', () => {
		if (router.nav.now.kind !== 'idle') return null;
		const id = (history.state as { ogygia?: unknown } | null)?.ogygia;
		// (an entry the router has not met yet: the browser's own fragment jump, the app's pushState)
		if (typeof id !== 'string') return null;
		const page = router.history.current;
		return id === page.id
			? null
			: `the address bar is on entry ${id}, the history model on ${page.id}`;
	});
}

// ── no failure without a code ──

const CODE_LINK_RE = /ogygiajs\.dev\/e\/[a-z_]+/;
/** A stack frame's file, in Chromium's, Firefox's and WebKit's spellings alike. */
const FRAME_URL_RE = /((?:https?|file):\/\/[^\s()@]+?):\d+:\d+/;
/** (The failures that left ogygia without a code, as found, are `R.uncoded`.) */

/** Where ogygia's own code is served from (`install_rules`, {@link own_code_of}), or null. */
let own_code: string | null = null;

/**
 * The folder ogygia's own code is served from, given this module's URL: core's `src/` when the
 * module is served as source (dev, the browser tests: each module has a URL of its own). Null in a
 * bundle: a chunk can hold the app's code beside ours (the runtime entry carries the app's client
 * plugins), so a frame in it does not say whose code threw (test/browser/rules-uncoded-own-code.test.ts).
 */
export function own_code_of(module_url: string): string | null {
	const own = module_url.split(/[?#]/)[0];
	return own.endsWith('/src/runtime/rules.ts') ? new URL('../', own).href : null;
}

/** The file of the error's top frame that has one (a native frame, say `decodeURIComponent`'s, has
 *  none), or null. */
function thrown_at(error: Error): string | null {
	let stack = error.stack ?? '';
	// (Chromium's stack starts with the message, which may itself hold a URL)
	const head = `${error.name}: ${error.message}`;
	if (stack.startsWith(head)) stack = stack.slice(head.length);
	return FRAME_URL_RE.exec(stack)?.[1] ?? null;
}

function failure(reason: unknown): void {
	if (R.uncoded.length >= 10) return;
	if (reason === STALE) {
		R.uncoded.push('a STALE escaped as a rejection');
		return;
	}
	const message =
		reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
	const line = message.split('\n')[0].slice(0, 160);
	if (message.startsWith('[ogygia]')) {
		if (!CODE_LINK_RE.test(message)) R.uncoded.push(`an ogygia error with no code: ${line}`);
		return;
	}
	// (a failure thrown in ogygia's own code is ogygia's, whatever it says, #1475)
	if (reason instanceof Error && own_code !== null && thrown_at(reason)?.startsWith(own_code))
		R.uncoded.push(`a ${reason.name} thrown in ogygia's code, with no code: ${line}`);
}

const no_failure_uncoded = (): string | null =>
	R.uncoded.length === 0 ? null : R.uncoded.join('; ');

// ── a region shows the answer its address holds ──

/** What a bound region was handed at its frame-store address, what it painted of it, and how many
 *  handed answers wait for their turn. */
type Shows = {
	address: string;
	handed: number;
	shown: number;
	out: number;
	painting: () => boolean;
};

/** The frame store's applied answer at an address (./frames.ts hands it over when it installs). */
let held_at: ((address: string) => { v: number } | null) | null = null;

/** The frame store is on the page: the rule reads what each address holds from it. */
export function watch_frames(peek: (address: string) => { v: number } | null): void {
	held_at = peek;
}

// ── the scheduler counts the turns it holds ──

/** The hydration scheduler's own check (./schedule.ts hands it over as it loads). */
let turns_check: (() => string | null) | null = null;

/** The scheduler is on the page: the rule asks it whether its count holds. */
export function watch_turns(check: () => string | null): void {
	turns_check = check;
}

const turns_counted = (): string | null => (turns_check === null ? null : turns_check());

/** The store handed `region` the answer with ticket `v` at `address` (`painting`: one of its
 *  answers is being painted now). */
export function note_handed(
	region: Element,
	address: string,
	v: number,
	painting: () => boolean
): void {
	const s = R.shows.get(region);
	if (s && s.address === address) {
		s.handed = v;
		s.out++;
	} else R.shows.set(region, { address, handed: v, shown: 0, out: 1, painting });
}

/** A handed answer's turn came (its paint starts, or it is dropped as older). */
export function note_turn(region: Element): void {
	const s = R.shows.get(region);
	if (s) s.out--;
}

/** `region` painted the answer with ticket `v`. */
export function note_shown(region: Element, v: number): void {
	const s = R.shows.get(region);
	if (s) s.shown = v;
}

/** `region` let its address go. */
export function note_unbound(region: Element): void {
	R.shows.delete(region);
}

function regions_show_their_answers(): string | null {
	if (held_at === null) return null;
	for (const [region, s] of R.shows) {
		if (!region.isConnected) continue;
		const held = held_at(s.address);
		// (the store let it go: what the region shows is its own last answer, #336)
		if (held === null) continue;
		const name = region.getAttribute('entry') || s.address;
		if (held.v !== s.handed)
			return `${name} was last handed answer #${s.handed}, its address holds #${held.v}`;
		if (s.shown !== s.handed && s.out === 0 && !s.painting())
			return `${name} shows answer #${s.shown}, its address holds #${held.v}`;
	}
	return null;
}

// ── a parsed answer is inert ──

/** (What parses built that they should not have, as found, is `R.parsed_built`.) */

/** The rule's ear on every parse (./html-sink.ts calls it): an element of the parsed fragment that
 *  a component's constructor built (a defined name, an instance of its definition). */
function note_parse(fragment: DocumentFragment): void {
	if (R.parsed_built.length >= 10 || typeof customElements === 'undefined') return;
	const roots: Node[] = [fragment];
	for (let q = 0; q < roots.length; q++) {
		const walk = document.createTreeWalker(roots[q], 1 /* SHOW_ELEMENT */);
		for (let n = walk.nextNode() as Element | null; n; n = walk.nextNode() as Element | null) {
			if (n.shadowRoot) roots.push(n.shadowRoot);
			const ctor = customElements.get(n.localName);
			if (ctor !== undefined && n instanceof ctor) {
				R.parsed_built.push(`<${n.localName}> was built while its answer parsed`);
				return;
			}
		}
	}
}

const no_parse_upgraded = (): string | null =>
	R.parsed_built.length === 0 ? null : R.parsed_built.join('; ');

function note_unshipped_read(key: string): void {
	const said = `page.data.${key} on ${location.pathname}`;
	if (R.unshipped_reads.length < 10 && !R.unshipped_reads.includes(said))
		R.unshipped_reads.push(said);
	check_soon();
}

const no_unshipped_read = (): string | null =>
	R.unshipped_reads.length === 0 ? null : R.unshipped_reads.join('; ');

// ── a hydrate gives back every lake it lifted ──

/** An island's hydrate held `held` lakes of `region` and found `found` of them again after it
 *  (./lakes.ts `release`, by lake key): a count that differs drops content. */
export function note_lake_restore(region: Element, held: number, found: number): void {
	if (held !== found && R.lakes_unpaired.length < 10)
		R.lakes_unpaired.push(
			`${entry_of(region)} held ${held} lake(s) and found ${found} of them after its hydrate`
		);
}

const lakes_paired = (): string | null =>
	R.lakes_unpaired.length === 0 ? null : R.lakes_unpaired.join('; ');

// ── the head gains no <base>, refresh, CSP or cookie meta (SPA-HEAD) ──

type HeadDeny = Parameters<NonNullable<PageGlobals['__og_head_deny']>>[0];

/** The first document's own candidates (its server sent them, as `outerHTML`): never counted.
 *  Null: not watched yet. */
let first_head: ReadonlySet<string> | null = null;
/** The router's deny (./head-deny.ts), handed in as its lazy chunk loads (a lazy chunk never
 *  imports a boot module: test/runtime-boot-svelte-free.test.ts). Null: no navigation can have
 *  adopted anything yet. */
let head_deny: HeadDeny | null = null;

const head_candidates = (): Element[] =>
	Array.from(document.head.querySelectorAll('base, meta[http-equiv]'));

function head_not_adopted(): string | null {
	if (head_deny === null || first_head === null) return null;
	for (const node of head_candidates()) {
		const html = node.outerHTML;
		if (head_deny(node) && !first_head.has(html))
			return `${html.slice(0, 160)} came into the head after the first document`;
	}
	return null;
}

/** Takes the first document's head as it is now, and checks it never gains a node the router
 *  denies (`__og_head_deny`, called by ./router-nav.ts with ./head-deny.ts's). */
export function watch_head(): void {
	if (first_head === null) runtime_rules.add('rule_head_adopted', head_not_adopted);
	first_head = new Set(head_candidates().map((n) => n.outerHTML));
	(globalThis as PageGlobals).__og_head_deny = (deny) => (head_deny = deny);
}

// ── the runner ──

let installed = false;
let pending = false;

/** Checks every rule a task from now (once, however many moves ask), and says what broke. */
function check_soon(): void {
	if (pending) return;
	pending = true;
	// oxlint-disable-next-line ogygia/owned-effects -- dev's rule check, a task after the moves that asked for it: it ends itself, and the document's rules outlive every page
	timers.after(() => {
		pending = false;
		runtime_rules.say((code, detail) => warn(code, { detail }));
	}, 0);
}

/** Rules on: `globalThis.__ogygia_rules()` gives what is broken now (for e2e); in dev they are also
 *  checked after machine moves, and what broke is said with its code. `globalThis.__ogygia_moves()`
 *  gives this document's machine moves, one line each (the last 500), for a failing e2e test to
 *  print. */
export function install_rules(dev: boolean): void {
	if (installed || typeof window === 'undefined') return;
	installed = true;
	own_code = own_code_of(import.meta.url);
	runtime_rules.add('rule_region_mounted_twice', one_mount_per_region);
	runtime_rules.add('rule_old_page_open', no_old_page_open);
	runtime_rules.add('rule_failure_uncoded', no_failure_uncoded);
	runtime_rules.add('rule_parse_upgraded', no_parse_upgraded);
	runtime_rules.add('rule_lake_restored', lakes_paired);
	runtime_rules.add('rule_markup_known', markup_known);
	runtime_rules.add('rule_region_answer_behind', regions_show_their_answers);
	runtime_rules.add('rule_region_left_busy', regions_left_at_rest);
	runtime_rules.add('rule_turns_counted', turns_counted);
	watch_head();
	(globalThis as PageGlobals).__og_parsed = note_parse;
	runtime_rules.add('rule_seed_key_unshipped', no_unshipped_read);
	(globalThis as { __og_unshipped_read?: (key: string) => void }).__og_unshipped_read =
		note_unshipped_read;
	(globalThis as { __ogygia_rules?: () => BrokenRule[] }).__ogygia_rules = () =>
		runtime_rules.broken();
	const moves = trace();
	(globalThis as { __ogygia_moves?: () => string }).__ogygia_moves = () => moves.text();
	// oxlint-disable-next-line ogygia/owned-effects -- the rules' ear for failures nobody caught, installed once: it lives as long as the document
	window.addEventListener('unhandledrejection', (event) => failure(event.reason));
	// oxlint-disable-next-line ogygia/owned-effects -- the rules' ear for failures nobody caught, installed once: it lives as long as the document
	window.addEventListener('error', (event) => failure(event.error ?? event.message));
	if (dev) observe(check_soon);
}
