/**
 * THE RUNTIME'S RULES (#313, ../rules.ts): what is always true of a page, checked in dev a task
 * after machine moves (a navigation is the navigation machine's) and by e2e at the end of a test.
 *
 * - `rule_region_mounted_twice`: one mount per region. A region element holds one island at a time,
 *   and an island whose element left the page is let go with it.
 * - `rule_address_bar_drift`: the address bar and the router's history model (whose current entry
 *   is the page on screen's) agree once no navigation is out.
 * - `rule_old_page_open`: nothing of a page that was left is still open (its visit's scope closed:
 *   its listeners, timers, streams).
 * - `rule_failure_uncoded`: no failure leaves ogygia without a code: an uncaught ogygia error names
 *   its code's page, and a `STALE` never escapes as a rejection.
 * - `rule_parse_upgraded`: a parsed answer is inert (./html-sink.ts, #382): no element of it was
 *   built by a component's constructor before the restore reached it.
 * - `rule_head_adopted`: the head never gains a `<base>` or a refresh / CSP / cookie meta after the
 *   first document (SPA-HEAD, ./head-deny.ts).
 *
 * Each area tells this module what it holds (`note_mount`, `note_visit`, `watch_router`) only when
 * rules are on (`RULES`): every call site folds out of a build without them.
 */
import { observe, STALE, trace } from '@ogygia/machine';
import { Rules, type BrokenRule } from '../rules.ts';
import { warn } from '../messages/core.ts';

type RuntimeRule =
	| 'rule_region_mounted_twice'
	| 'rule_address_bar_drift'
	| 'rule_old_page_open'
	| 'rule_failure_uncoded'
	| 'rule_parse_upgraded'
	| 'rule_head_adopted';

/** The runtime's rules. */
export const runtime_rules: Rules<RuntimeRule> = /* @__PURE__ */ new Rules<RuntimeRule>();

// ── one mount per region ──

/** The region elements that hold an island now, and how many. */
const mounts = new Map<Element, number>();

/** A region element mounted its island. */
export function note_mount(region: Element): void {
	mounts.set(region, (mounts.get(region) ?? 0) + 1);
}

/** A region element let its island go. */
export function note_unmount(region: Element): void {
	const n = (mounts.get(region) ?? 0) - 1;
	if (n > 0) mounts.set(region, n);
	else mounts.delete(region);
}

const entry_of = (region: Element): string => region.getAttribute('entry') ?? region.tagName;

function one_mount_per_region(): string | null {
	for (const [region, n] of mounts) {
		if (n > 1) return `${entry_of(region)} holds ${n} islands at once`;
		// (a region moved within one task is still the page's: its teardown waits a microtask, and a
		// check runs a task after the moves)
		if (!region.isConnected)
			return `${entry_of(region)} left the page with its island still mounted`;
	}
	return null;
}

// ── nothing of an old page still open ──

type Visit = { readonly scope: { readonly closed: boolean } };

/** Each visit made, in the order made: one older than the page on screen's is over. */
const visits: Array<{ visit: Visit; n: number }> = [];
let visit_n = 0;
let current: Visit | null = null;

/** A page visit was made (`current`: it is the page on screen's now). */
export function note_visit(visit: Visit, is_current: boolean): void {
	if (!visits.some((v) => v.visit === visit)) visits.push({ visit, n: ++visit_n });
	if (is_current) current = visit;
}

function no_old_page_open(): string | null {
	const now = visits.find((v) => v.visit === current);
	if (now === undefined) return null;
	for (let i = visits.length - 1; i >= 0; i--)
		if (visits[i].visit.scope.closed) visits.splice(i, 1);
	const open = visits.filter((v) => v.n < now.n).length;
	return open === 0 ? null : `${open} page visit(s) before the one on screen still open`;
}

// ── the address bar, the history model, the page ──

/** What the rule reads of the router: its navigation, and its history model's page on screen. */
interface RouterView {
	readonly nav: { readonly now: { readonly kind: string } };
	readonly history: { readonly current: { readonly id: string; readonly url: URL } };
}

const no_hash = (href: string): string => href.split('#')[0];

/** The router started: its history model is checked against the address bar. */
export function watch_router(router: RouterView): void {
	runtime_rules.add('rule_address_bar_drift', () => {
		if (router.nav.now.kind !== 'idle') return null;
		const id = (history.state as { ogygia?: unknown } | null)?.ogygia;
		// (an entry the router has not met yet: the browser's own fragment jump, the app's pushState)
		if (typeof id !== 'string') return null;
		const page = router.history.current;
		if (id !== page.id) return `the address bar is on entry ${id}, the history model on ${page.id}`;
		const bar = no_hash(location.href);
		const model = no_hash(page.url.href);
		return bar === model ? null : `the address bar is ${bar}, the history model's page ${model}`;
	});
}

// ── no failure without a code ──

const CODE_LINK_RE = /ogygiajs\.dev\/e\/[a-z_]+/;
/** The failures that left ogygia without a code, as found (a few). */
const uncoded: string[] = [];

function failure(reason: unknown): void {
	if (uncoded.length >= 10) return;
	if (reason === STALE) {
		uncoded.push('a STALE escaped as a rejection');
		return;
	}
	const message =
		reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
	if (message.startsWith('[ogygia]') && !CODE_LINK_RE.test(message))
		uncoded.push('an ogygia error with no code: ' + message.split('\n')[0].slice(0, 160));
}

const no_failure_uncoded = (): string | null => (uncoded.length === 0 ? null : uncoded.join('; '));

// ── a parsed answer is inert ──

/** What parses built that they should not have, as found (a few). */
const parsed_built: string[] = [];

/** The rule's ear on every parse (./html-sink.ts calls it): an element of the parsed fragment that
 *  a component's constructor built (a defined name, an instance of its definition). */
function note_parse(fragment: DocumentFragment): void {
	if (parsed_built.length >= 10 || typeof customElements === 'undefined') return;
	const roots: Node[] = [fragment];
	for (let q = 0; q < roots.length; q++) {
		const walk = document.createTreeWalker(roots[q], 1 /* SHOW_ELEMENT */);
		for (let n = walk.nextNode() as Element | null; n; n = walk.nextNode() as Element | null) {
			if (n.shadowRoot) roots.push(n.shadowRoot);
			const ctor = customElements.get(n.localName);
			if (ctor !== undefined && n instanceof ctor) {
				parsed_built.push(`<${n.localName}> was built while its answer parsed`);
				return;
			}
		}
	}
}

const no_parse_upgraded = (): string | null =>
	parsed_built.length === 0 ? null : parsed_built.join('; ');

// ── the head gains no <base>, refresh, CSP or cookie meta (SPA-HEAD) ──

type HeadDeny = (node: Element) => boolean;

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
	(globalThis as { __og_head_deny?: (deny: HeadDeny) => void }).__og_head_deny = (deny) =>
		(head_deny = deny);
}

// ── the runner ──

let installed = false;
let pending = false;

/** Checks every rule a task from now (once, however many moves ask), and says what broke. */
function check_soon(): void {
	if (pending) return;
	pending = true;
	// oxlint-disable-next-line ogygia/owned-effects -- dev's rule check, a task after the moves that asked for it: it ends itself, and the document's rules outlive every page
	setTimeout(() => {
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
	runtime_rules.add('rule_region_mounted_twice', one_mount_per_region);
	runtime_rules.add('rule_old_page_open', no_old_page_open);
	runtime_rules.add('rule_failure_uncoded', no_failure_uncoded);
	runtime_rules.add('rule_parse_upgraded', no_parse_upgraded);
	watch_head();
	(globalThis as { __og_parsed?: (f: DocumentFragment) => void }).__og_parsed = note_parse;
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
