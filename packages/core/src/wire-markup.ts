/**
 * THE PAGE MARKUP'S VOCABULARY (#479). Server HTML and the runtime meet through `data-og*` /
 * `data-ogygia-*` attributes: the server writes them, and the runtime, the router, federation,
 * postrender and devtools read them back. `MARK` declares every one, once: `page` for the page's
 * own protocol, `devtools` for the devtools and profiler UI.
 *
 * - A `data-og*` name a package spells is in `MARK` (test/wire-markup.test.ts reads the sources).
 * - A page carries no ogygia marker `MARK` does not declare (`unknown_markers`, the runtime rule
 *   `rule_markup_known` in dev and e2e). An app's own `data-og-*` (Open Graph tooling, say) is
 *   the app's: the rule reads `data-og-*` only on `ogygia-*` elements.
 * - `tags()` reads tags the way a browser does: quoted values may hold `>` and the other quote, a
 *   comment is skipped, and a tag name matches whole.
 */

/** Who writes a marker: the page's protocol, the devtools and profiler UI, or the docs site's
 *  Observatory (its render stubs). */
export type MarkOwner = 'page' | 'devtools' | 'docs';

/** One declared marker. */
export interface Mark {
	readonly attr: `data-og-${string}` | `data-ogygia-${string}`;
	readonly by: MarkOwner;
}

/** Every marker's key in `MARK`. Spelled out because core emits declarations in isolation;
 *  `MARK` must match it key for key (test/wire-markup.test-d.ts). */
export type MarkKey =
	| 'baked'
	| 'box'
	| 'cpu'
	| 'cpuFns'
	| 'cpuRecord'
	| 'csrNotice'
	| 'detail'
	| 'detailBarrel'
	| 'detailBrowser'
	| 'detailBytes'
	| 'detailHazard'
	| 'detailServer'
	| 'detailSession'
	| 'detailTop'
	| 'detailTwice'
	| 'dtIngested'
	| 'exp'
	| 'format'
	| 'fp'
	| 'fragmentFailed'
	| 'head'
	| 'healed'
	| 'hide'
	| 'highlight'
	| 'hole'
	| 'holeFailed'
	| 'html'
	| 'hydWindow'
	| 'hydration'
	| 'kept'
	| 'late'
	| 'lateBoot'
	| 'lateError'
	| 'ledgerExact'
	| 'ledgerShared'
	| 'ledgerTwice'
	| 'len'
	| 'locations'
	| 'mountFailed'
	| 'mountFallback'
	| 'mountMoved'
	| 'moved'
	| 'noReconcile'
	| 'opaque'
	| 'opaquen'
	| 'overlay'
	| 'overlayToggle'
	| 'owner'
	| 'pageBrowserLimits'
	| 'pageFindings'
	| 'pageHoles'
	| 'pageKept'
	| 'pageNav'
	| 'pageServer'
	| 'pageSince'
	| 'pageSinceNote'
	| 'pageSincePart'
	| 'pageStyles'
	| 'pageUnmeasured'
	| 'pageUnscoped'
	| 'panelToggle'
	| 'pick'
	| 'profileAnchors'
	| 'profileAssets'
	| 'profileFindings'
	| 'profileHead'
	| 'profileHot'
	| 'profileIslands'
	| 'profileRun'
	| 'profileScore'
	| 'profiler'
	| 'props'
	| 'recovered'
	| 'restore'
	| 'session'
	| 'sessionBrowserLimits'
	| 'sessionFindings'
	| 'sessionProfile'
	| 'sessionRequests'
	| 'sessionServer'
	| 'sessionServerState'
	| 'sessionServerToggle'
	| 'sessionStart'
	| 'sessionStop'
	| 'sessionTimeline'
	| 'sessionWindow'
	| 'shared'
	| 'skipped'
	| 'slot'
	| 'standIns'
	| 'static'
	| 'stitched'
	| 'stub'
	| 'tab'
	| 'vitals'
	| 'win'
	| 'wire'
	| 'woke'
	| 'ogygiaAnnouncer'
	| 'ogygiaBeacon'
	| 'ogygiaDevHmr'
	| 'ogygiaDevtoolsBoot'
	| 'ogygiaDevtoolsHost'
	| 'ogygiaFnm'
	| 'ogygiaGraph'
	| 'ogygiaGraphPreload'
	| 'ogygiaHoles'
	| 'ogygiaKeep'
	| 'ogygiaNoKeep'
	| 'ogygiaPage'
	| 'ogygiaProps'
	| 'ogygiaProvide'
	| 'ogygiaProvidePage'
	| 'ogygiaRcss'
	| 'ogygiaRegionCss'
	| 'ogygiaRemote'
	| 'ogygiaRuntime'
	| 'ogygiaRuntimeDep'
	| 'ogygiaSlot'
	| 'ogygiaSpeculate'
	| 'ogygiaSpeculateHint';

// Each marker's name as its own constant: a bundler inlines an exported string constant (and folds
// `` `[${OG_HOLE}]` `` into one literal), but never a property of `MARK`, which would ship the table.
/** Every `data-og-*` name starts so: an app may spell its own (Open Graph tooling, say). */
export const OG_PREFIX = 'data-og-';
/** Every `data-ogygia-*` name starts so: that namespace is ogygia's alone. */
export const OGYGIA_PREFIX = 'data-ogygia-';
export const OG_BAKED = 'data-og-baked';
export const OG_BOX = 'data-og-box';
export const OG_CPU = 'data-og-cpu';
export const OG_CPU_FNS = 'data-og-cpu-fns';
export const OG_CPU_RECORD = 'data-og-cpu-record';
export const OG_CSR_NOTICE = 'data-og-csr-notice';
export const OG_DETAIL = 'data-og-detail';
export const OG_DETAIL_BARREL = 'data-og-detail-barrel';
export const OG_DETAIL_BROWSER = 'data-og-detail-browser';
export const OG_DETAIL_BYTES = 'data-og-detail-bytes';
export const OG_DETAIL_HAZARD = 'data-og-detail-hazard';
export const OG_DETAIL_SERVER = 'data-og-detail-server';
export const OG_DETAIL_SESSION = 'data-og-detail-session';
export const OG_DETAIL_TOP = 'data-og-detail-top';
export const OG_DETAIL_TWICE = 'data-og-detail-twice';
export const OG_DT_INGESTED = 'data-og-dt-ingested';
export const OG_EXP = 'data-og-exp';
export const OG_FORMAT = 'data-og-format';
export const OG_FP = 'data-og-fp';
export const OG_FRAGMENT_FAILED = 'data-og-fragment-failed';
export const OG_HEAD = 'data-og-head';
export const OG_HEALED = 'data-og-healed';
export const OG_HIDE = 'data-og-hide';
export const OG_HIGHLIGHT = 'data-og-highlight';
export const OG_HOLE = 'data-og-hole';
export const OG_HOLE_FAILED = 'data-og-hole-failed';
export const OG_HTML = 'data-og-html';
export const OG_HYD_WINDOW = 'data-og-hyd-window';
export const OG_HYDRATION = 'data-og-hydration';
export const OG_KEPT = 'data-og-kept';
export const OG_LATE = 'data-og-late';
export const OG_LATE_BOOT = 'data-og-late-boot';
export const OG_LATE_ERROR = 'data-og-late-error';
export const OG_LEDGER_EXACT = 'data-og-ledger-exact';
export const OG_LEDGER_SHARED = 'data-og-ledger-shared';
export const OG_LEDGER_TWICE = 'data-og-ledger-twice';
export const OG_LEN = 'data-og-len';
export const OG_LOCATIONS = 'data-og-locations';
export const OG_MOUNT_FAILED = 'data-og-mount-failed';
export const OG_MOUNT_FALLBACK = 'data-og-mount-fallback';
export const OG_MOUNT_MOVED = 'data-og-mount-moved';
export const OG_MOVED = 'data-og-moved';
export const OG_NO_RECONCILE = 'data-og-no-reconcile';
export const OG_OPAQUE = 'data-og-opaque';
export const OG_OPAQUEN = 'data-og-opaquen';
export const OG_OVERLAY = 'data-og-overlay';
export const OG_OVERLAY_TOGGLE = 'data-og-overlay-toggle';
export const OG_OWNER = 'data-og-owner';
export const OG_PAGE_BROWSER_LIMITS = 'data-og-page-browser-limits';
export const OG_PAGE_FINDINGS = 'data-og-page-findings';
export const OG_PAGE_HOLES = 'data-og-page-holes';
export const OG_PAGE_KEPT = 'data-og-page-kept';
export const OG_PAGE_NAV = 'data-og-page-nav';
export const OG_PAGE_SERVER = 'data-og-page-server';
export const OG_PAGE_SINCE = 'data-og-page-since';
export const OG_PAGE_SINCE_NOTE = 'data-og-page-since-note';
export const OG_PAGE_SINCE_PART = 'data-og-page-since-part';
export const OG_PAGE_STYLES = 'data-og-page-styles';
export const OG_PAGE_UNMEASURED = 'data-og-page-unmeasured';
export const OG_PAGE_UNSCOPED = 'data-og-page-unscoped';
export const OG_PANEL_TOGGLE = 'data-og-panel-toggle';
export const OG_PICK = 'data-og-pick';
export const OG_PROFILE_ANCHORS = 'data-og-profile-anchors';
export const OG_PROFILE_ASSETS = 'data-og-profile-assets';
export const OG_PROFILE_FINDINGS = 'data-og-profile-findings';
export const OG_PROFILE_HEAD = 'data-og-profile-head';
export const OG_PROFILE_HOT = 'data-og-profile-hot';
export const OG_PROFILE_ISLANDS = 'data-og-profile-islands';
export const OG_PROFILE_RUN = 'data-og-profile-run';
export const OG_PROFILE_SCORE = 'data-og-profile-score';
export const OG_PROFILER = 'data-og-profiler';
export const OG_PROPS = 'data-og-props';
export const OG_RECOVERED = 'data-og-recovered';
export const OG_RESTORE = 'data-og-restore';
export const OG_SESSION = 'data-og-session';
export const OG_SESSION_BROWSER_LIMITS = 'data-og-session-browser-limits';
export const OG_SESSION_FINDINGS = 'data-og-session-findings';
export const OG_SESSION_PROFILE = 'data-og-session-profile';
export const OG_SESSION_REQUESTS = 'data-og-session-requests';
export const OG_SESSION_SERVER = 'data-og-session-server';
export const OG_SESSION_SERVER_STATE = 'data-og-session-server-state';
export const OG_SESSION_SERVER_TOGGLE = 'data-og-session-server-toggle';
export const OG_SESSION_START = 'data-og-session-start';
export const OG_SESSION_STOP = 'data-og-session-stop';
export const OG_SESSION_TIMELINE = 'data-og-session-timeline';
export const OG_SESSION_WINDOW = 'data-og-session-window';
export const OG_SHARED = 'data-og-shared';
export const OG_SKIPPED = 'data-og-skipped';
export const OG_SLOT = 'data-og-slot';
export const OG_STAND_INS = 'data-og-stand-ins';
export const OG_STATIC = 'data-og-static';
export const OG_STITCHED = 'data-og-stitched';
export const OG_STUB = 'data-og-stub';
export const OG_TAB = 'data-og-tab';
export const OG_VITALS = 'data-og-vitals';
export const OG_WIN = 'data-og-win';
export const OG_WIRE = 'data-og-wire';
export const OG_WOKE = 'data-og-woke';
export const OGYGIA_ANNOUNCER = 'data-ogygia-announcer';
export const OGYGIA_BEACON = 'data-ogygia-beacon';
export const OGYGIA_DEV_HMR = 'data-ogygia-dev-hmr';
export const OGYGIA_DEVTOOLS_BOOT = 'data-ogygia-devtools-boot';
export const OGYGIA_DEVTOOLS_HOST = 'data-ogygia-devtools-host';
export const OGYGIA_FNM = 'data-ogygia-fnm';
export const OGYGIA_GRAPH = 'data-ogygia-graph';
export const OGYGIA_GRAPH_PRELOAD = 'data-ogygia-graph-preload';
export const OGYGIA_HOLES = 'data-ogygia-holes';
export const OGYGIA_KEEP = 'data-ogygia-keep';
export const OGYGIA_NO_KEEP = 'data-ogygia-no-keep';
export const OGYGIA_PAGE = 'data-ogygia-page';
export const OGYGIA_PROPS = 'data-ogygia-props';
export const OGYGIA_PROVIDE = 'data-ogygia-provide';
export const OGYGIA_PROVIDE_PAGE = 'data-ogygia-provide-page';
export const OGYGIA_RCSS = 'data-ogygia-rcss';
export const OGYGIA_REGION_CSS = 'data-ogygia-region-css';
export const OGYGIA_REMOTE = 'data-ogygia-remote';
export const OGYGIA_RUNTIME = 'data-ogygia-runtime';
export const OGYGIA_RUNTIME_DEP = 'data-ogygia-runtime-dep';
export const OGYGIA_SLOT = 'data-ogygia-slot';
export const OGYGIA_SPECULATE = 'data-ogygia-speculate';
export const OGYGIA_SPECULATE_HINT = 'data-ogygia-speculate-hint';

/** Every marker, once. A key not in `MarkKey` (or a `MarkKey` missing here) does not compile. */
export const MARK: { readonly [K in MarkKey]: Mark } = {
	baked: { attr: OG_BAKED, by: 'page' },
	box: { attr: OG_BOX, by: 'devtools' },
	cpu: { attr: OG_CPU, by: 'devtools' },
	cpuFns: { attr: OG_CPU_FNS, by: 'devtools' },
	cpuRecord: { attr: OG_CPU_RECORD, by: 'devtools' },
	csrNotice: { attr: OG_CSR_NOTICE, by: 'devtools' },
	detail: { attr: OG_DETAIL, by: 'devtools' },
	detailBarrel: { attr: OG_DETAIL_BARREL, by: 'devtools' },
	detailBrowser: { attr: OG_DETAIL_BROWSER, by: 'devtools' },
	detailBytes: { attr: OG_DETAIL_BYTES, by: 'devtools' },
	detailHazard: { attr: OG_DETAIL_HAZARD, by: 'devtools' },
	detailServer: { attr: OG_DETAIL_SERVER, by: 'devtools' },
	detailSession: { attr: OG_DETAIL_SESSION, by: 'devtools' },
	detailTop: { attr: OG_DETAIL_TOP, by: 'devtools' },
	detailTwice: { attr: OG_DETAIL_TWICE, by: 'devtools' },
	dtIngested: { attr: OG_DT_INGESTED, by: 'page' },
	exp: { attr: OG_EXP, by: 'page' },
	format: { attr: OG_FORMAT, by: 'page' },
	fp: { attr: OG_FP, by: 'page' },
	fragmentFailed: { attr: OG_FRAGMENT_FAILED, by: 'page' },
	head: { attr: OG_HEAD, by: 'page' },
	healed: { attr: OG_HEALED, by: 'page' },
	hide: { attr: OG_HIDE, by: 'devtools' },
	highlight: { attr: OG_HIGHLIGHT, by: 'devtools' },
	hole: { attr: OG_HOLE, by: 'page' },
	holeFailed: { attr: OG_HOLE_FAILED, by: 'devtools' },
	html: { attr: OG_HTML, by: 'page' },
	hydWindow: { attr: OG_HYD_WINDOW, by: 'devtools' },
	hydration: { attr: OG_HYDRATION, by: 'devtools' },
	kept: { attr: OG_KEPT, by: 'page' },
	late: { attr: OG_LATE, by: 'page' },
	lateBoot: { attr: OG_LATE_BOOT, by: 'page' },
	lateError: { attr: OG_LATE_ERROR, by: 'page' },
	ledgerExact: { attr: OG_LEDGER_EXACT, by: 'devtools' },
	ledgerShared: { attr: OG_LEDGER_SHARED, by: 'devtools' },
	ledgerTwice: { attr: OG_LEDGER_TWICE, by: 'devtools' },
	len: { attr: OG_LEN, by: 'page' },
	locations: { attr: OG_LOCATIONS, by: 'page' },
	mountFailed: { attr: OG_MOUNT_FAILED, by: 'page' },
	mountFallback: { attr: OG_MOUNT_FALLBACK, by: 'page' },
	mountMoved: { attr: OG_MOUNT_MOVED, by: 'page' },
	moved: { attr: OG_MOVED, by: 'page' },
	noReconcile: { attr: OG_NO_RECONCILE, by: 'page' },
	opaque: { attr: OG_OPAQUE, by: 'page' },
	opaquen: { attr: OG_OPAQUEN, by: 'page' },
	overlay: { attr: OG_OVERLAY, by: 'devtools' },
	overlayToggle: { attr: OG_OVERLAY_TOGGLE, by: 'devtools' },
	owner: { attr: OG_OWNER, by: 'page' },
	pageBrowserLimits: { attr: OG_PAGE_BROWSER_LIMITS, by: 'devtools' },
	pageFindings: { attr: OG_PAGE_FINDINGS, by: 'devtools' },
	pageHoles: { attr: OG_PAGE_HOLES, by: 'devtools' },
	pageKept: { attr: OG_PAGE_KEPT, by: 'devtools' },
	pageNav: { attr: OG_PAGE_NAV, by: 'devtools' },
	pageServer: { attr: OG_PAGE_SERVER, by: 'devtools' },
	pageSince: { attr: OG_PAGE_SINCE, by: 'devtools' },
	pageSinceNote: { attr: OG_PAGE_SINCE_NOTE, by: 'devtools' },
	pageSincePart: { attr: OG_PAGE_SINCE_PART, by: 'devtools' },
	pageStyles: { attr: OG_PAGE_STYLES, by: 'devtools' },
	pageUnmeasured: { attr: OG_PAGE_UNMEASURED, by: 'devtools' },
	pageUnscoped: { attr: OG_PAGE_UNSCOPED, by: 'devtools' },
	panelToggle: { attr: OG_PANEL_TOGGLE, by: 'devtools' },
	pick: { attr: OG_PICK, by: 'devtools' },
	profileAnchors: { attr: OG_PROFILE_ANCHORS, by: 'devtools' },
	profileAssets: { attr: OG_PROFILE_ASSETS, by: 'devtools' },
	profileFindings: { attr: OG_PROFILE_FINDINGS, by: 'devtools' },
	profileHead: { attr: OG_PROFILE_HEAD, by: 'devtools' },
	profileHot: { attr: OG_PROFILE_HOT, by: 'devtools' },
	profileIslands: { attr: OG_PROFILE_ISLANDS, by: 'devtools' },
	profileRun: { attr: OG_PROFILE_RUN, by: 'devtools' },
	profileScore: { attr: OG_PROFILE_SCORE, by: 'devtools' },
	profiler: { attr: OG_PROFILER, by: 'devtools' },
	props: { attr: OG_PROPS, by: 'devtools' },
	recovered: { attr: OG_RECOVERED, by: 'page' },
	restore: { attr: OG_RESTORE, by: 'page' },
	session: { attr: OG_SESSION, by: 'devtools' },
	sessionBrowserLimits: { attr: OG_SESSION_BROWSER_LIMITS, by: 'devtools' },
	sessionFindings: { attr: OG_SESSION_FINDINGS, by: 'devtools' },
	sessionProfile: { attr: OG_SESSION_PROFILE, by: 'devtools' },
	sessionRequests: { attr: OG_SESSION_REQUESTS, by: 'devtools' },
	sessionServer: { attr: OG_SESSION_SERVER, by: 'devtools' },
	sessionServerState: { attr: OG_SESSION_SERVER_STATE, by: 'devtools' },
	sessionServerToggle: { attr: OG_SESSION_SERVER_TOGGLE, by: 'devtools' },
	sessionStart: { attr: OG_SESSION_START, by: 'devtools' },
	sessionStop: { attr: OG_SESSION_STOP, by: 'devtools' },
	sessionTimeline: { attr: OG_SESSION_TIMELINE, by: 'devtools' },
	sessionWindow: { attr: OG_SESSION_WINDOW, by: 'devtools' },
	shared: { attr: OG_SHARED, by: 'page' },
	skipped: { attr: OG_SKIPPED, by: 'page' },
	slot: { attr: OG_SLOT, by: 'page' },
	standIns: { attr: OG_STAND_INS, by: 'page' },
	static: { attr: OG_STATIC, by: 'page' },
	stitched: { attr: OG_STITCHED, by: 'page' },
	stub: { attr: OG_STUB, by: 'docs' },
	tab: { attr: OG_TAB, by: 'devtools' },
	vitals: { attr: OG_VITALS, by: 'devtools' },
	win: { attr: OG_WIN, by: 'devtools' },
	wire: { attr: OG_WIRE, by: 'page' },
	woke: { attr: OG_WOKE, by: 'page' },
	ogygiaAnnouncer: { attr: OGYGIA_ANNOUNCER, by: 'page' },
	ogygiaBeacon: { attr: OGYGIA_BEACON, by: 'devtools' },
	ogygiaDevHmr: { attr: OGYGIA_DEV_HMR, by: 'page' },
	ogygiaDevtoolsBoot: { attr: OGYGIA_DEVTOOLS_BOOT, by: 'page' },
	ogygiaDevtoolsHost: { attr: OGYGIA_DEVTOOLS_HOST, by: 'devtools' },
	ogygiaFnm: { attr: OGYGIA_FNM, by: 'page' },
	ogygiaGraph: { attr: OGYGIA_GRAPH, by: 'page' },
	ogygiaGraphPreload: { attr: OGYGIA_GRAPH_PRELOAD, by: 'page' },
	ogygiaHoles: { attr: OGYGIA_HOLES, by: 'page' },
	ogygiaKeep: { attr: OGYGIA_KEEP, by: 'page' },
	ogygiaNoKeep: { attr: OGYGIA_NO_KEEP, by: 'page' },
	ogygiaPage: { attr: OGYGIA_PAGE, by: 'page' },
	ogygiaProps: { attr: OGYGIA_PROPS, by: 'page' },
	ogygiaProvide: { attr: OGYGIA_PROVIDE, by: 'page' },
	ogygiaProvidePage: { attr: OGYGIA_PROVIDE_PAGE, by: 'page' },
	ogygiaRcss: { attr: OGYGIA_RCSS, by: 'page' },
	ogygiaRegionCss: { attr: OGYGIA_REGION_CSS, by: 'page' },
	ogygiaRemote: { attr: OGYGIA_REMOTE, by: 'page' },
	ogygiaRuntime: { attr: OGYGIA_RUNTIME, by: 'page' },
	ogygiaRuntimeDep: { attr: OGYGIA_RUNTIME_DEP, by: 'page' },
	ogygiaSlot: { attr: OGYGIA_SLOT, by: 'page' },
	ogygiaSpeculate: { attr: OGYGIA_SPECULATE, by: 'page' },
	ogygiaSpeculateHint: { attr: OGYGIA_SPECULATE_HINT, by: 'page' }
} as const satisfies Record<string, Mark>;

// static: every declared marker's name, made once from MARK (pure: a bundle that reads only the
// tag reader drops it, and MARK with it)
const DECLARED: ReadonlySet<string> = /* @__PURE__ */ (() =>
	new Set(Object.values(MARK).map((m) => m.attr)))();

const MARKER = /^data-og(?:ygia)?-/;

/** Whether `name` is a declared marker. */
export function is_marker(name: string): boolean {
	return DECLARED.has(name);
}

/** The `data-og*` names among `names` that `MARK` does not declare. */
export function unknown_markers(names: Iterable<string>): string[] {
	const out: string[] = [];
	for (const n of names) if (MARKER.test(n) && !DECLARED.has(n)) out.push(n);
	return out;
}

/** One tag `tags()` found: where it starts and ends in the HTML, and its attributes (names in
 *  lower case, a bare attribute's value `''`). `attr(name)` reads one attribute without building
 *  `attrs`; `attrs` is read once, on first use. */
export interface FoundTag {
	readonly start: number;
	readonly end: number;
	/** Where a walk goes on after this tag: past its text when it opens a raw-text element (a
	 *  script, a style…, whose text holds no tag), else `end`; `html.length` when that text never
	 *  closes. `next_tag(html, name, t.next)` is the next tag after `t`. */
	readonly next: number;
	readonly attrs: Map<string, string>;
	/** One attribute's value (`''` when bare; the first one wins), or undefined. `name` in lower case. */
	attr(name: string): string | undefined;
}

// ── THE WALK ────────────────────────────────────────────────────────────────────────────────────
// One tokenizer walk over HTML text, the browser's data state: comments (`<!-->`, `<!--->` and `--!>`
// end one too), bogus comments (`<!x …>`, `<?x …>`, CDATA, `</ …>`), end tags (their quoted values
// read, so a `>` inside one does not end it), and start tags, after which a raw-text element's text
// (script with its `<!--` escapes, style, textarea, title, xmp, iframe, noembed, noframes, noscript;
// plaintext to the end) holds no tag. Every reader below is a view over it. Pinned against parse5 by
// test/wire-markup-differential.test.ts. (Foreign content is not modelled: an `<svg>`'s `<style>`
// is read as raw text, as in HTML.)

/** HTML's whitespace inside a tag: tab, LF, FF, CR, space (NaN, past the end, is not). */
function is_space(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

/** `[A-Za-z]`: what starts a tag name (`<3` and `< p` are text). */
function is_letter(c: number): boolean {
	return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

/** Where a tag name that starts at `from` ends (whitespace, `/`, `>` or the end). */
function name_end(html: string, from: number): number {
	const n = html.length;
	let j = from;
	for (; j < n; j++) {
		const c = html.charCodeAt(j);
		if (c === 62 || c === 47 || (c <= 32 && is_space(c))) break;
	}
	return j;
}

/** Is `html[from, to)` the lower-case ASCII `name`, in any case? */
function name_is(html: string, from: number, to: number, name: string): boolean {
	if (to - from !== name.length) return false;
	for (let k = 0; k < name.length; k++) {
		let c = html.charCodeAt(from + k);
		if (c >= 65 && c <= 90) c += 32;
		if (c !== name.charCodeAt(k)) return false;
	}
	return true;
}

/** The elements whose text the tokenizer reads raw, up to their own end tag. */
const RAW_TEXT = [
	'script',
	'style',
	'textarea',
	'title',
	'xmp',
	'iframe',
	'noembed',
	'noframes',
	'noscript',
	'plaintext'
];

/** The raw-text element named `html[from, to)`, or null. */
function raw_name(html: string, from: number, to: number): string | null {
	const len = to - from;
	if (len < 3 || len > 9) return null;
	for (const r of RAW_TEXT) if (name_is(html, from, to, r)) return r;
	return null;
}

/** Does `</name` (any case) followed by whitespace, `/` or `>` start at `at`? */
function closes(html: string, at: number, name: string): boolean {
	if (html.charCodeAt(at) !== 60 || html.charCodeAt(at + 1) !== 47) return false;
	const end = at + 2 + name.length;
	if (!name_is(html, at + 2, end, name)) return false;
	const c = html.charCodeAt(end);
	return c === 62 || c === 47 || is_space(c);
}

/** Where the `</script` that ends a script's text (from `from`) begins (-1: none), by the
 *  tokenizer's script-data states: after `<!--` the text is ESCAPED until `-->`, and an escaped
 *  `<script` opens a DOUBLE-ESCAPED run where `</script` does not end the script. */
function script_close(html: string, from: number): number {
	let i = from;
	for (;;) {
		const lt = html.indexOf('<', i);
		if (lt === -1) return -1;
		if (closes(html, lt, 'script')) return lt;
		if (!html.startsWith('<!--', lt)) {
			i = lt + 1;
			continue;
		}
		// escaped (the `--` of `<!--` already read, so `<!-->` ends it at once)
		let j = lt + 2;
		for (;;) {
			const dash = html.indexOf('-->', j);
			const open = html.indexOf('<', j);
			if (open === -1 || (dash !== -1 && dash < open)) {
				if (dash === -1) return -1;
				i = dash + 3;
				break;
			}
			if (closes(html, open, 'script')) return open;
			const ne = name_end(html, open + 1);
			if (!name_is(html, open + 1, ne, 'script')) {
				j = open + 1;
				continue;
			}
			// double escaped: `-->` returns to script data, `</script` to escaped
			let k = ne;
			let back = -1;
			for (;;) {
				const d = html.indexOf('-->', k);
				const c = html.indexOf('</', k);
				if (d === -1 && c === -1) return -1;
				if (c !== -1 && (d === -1 || c < d)) {
					if (closes(html, c, 'script')) {
						j = c + 8;
						break;
					}
					k = c + 2;
					continue;
				}
				back = d + 3;
				break;
			}
			if (back !== -1) {
				i = back;
				break;
			}
		}
	}
}

/** Where the end tag that closes the raw text of `raw` (from `from`) starts (-1: never). */
function raw_close(html: string, from: number, raw: string): number {
	if (raw === 'script') return script_close(html, from);
	if (raw === 'plaintext') return -1;
	for (let at = html.indexOf('</', from); at !== -1; at = html.indexOf('</', at + 2))
		if (closes(html, at, raw)) return at;
	return -1;
}

/** What `read_attrs` hands each attribute: its name's span and its value's (`vq` the quote's char
 *  code, 0 when unquoted, -1 when bare: no `=`). */
type AttrSink = (ns: number, ne: number, vs: number, ve: number, vq: number) => boolean | void;

/**
 * Read a tag's attributes from `j` (just past its name) to its `>`, handing each to `sink` (which
 * may stop the read by returning true). Returns the index just past the `>`, or -1 when the input
 * ends inside the tag (the browser drops it): a quoted value may hold `>` and the other quote; an
 * unquoted one ends at whitespace or `>`; a name's first character may be `=`.
 */
function read_attrs(html: string, j: number, sink: AttrSink | null): number {
	const n = html.length;
	for (;;) {
		let c = html.charCodeAt(j);
		while (c === 47 || (c <= 32 && is_space(c))) c = html.charCodeAt(++j);
		if (j >= n) return -1;
		if (c === 62) return j + 1;
		const ns = j++;
		for (; j < n; j++) {
			c = html.charCodeAt(j);
			if (c === 61 || c === 62 || c === 47 || (c <= 32 && is_space(c))) break;
		}
		const ne = j;
		while (c <= 32 && is_space(c)) c = html.charCodeAt(++j);
		let vs = j;
		let ve = j;
		let vq = -1;
		if (c === 61 /* = */) {
			vq = 0;
			c = html.charCodeAt(++j);
			while (c <= 32 && is_space(c)) c = html.charCodeAt(++j);
			if (c === 34 || c === 39) {
				const close = html.indexOf(c === 34 ? '"' : "'", j + 1);
				if (close === -1) return -1;
				vq = c;
				vs = j + 1;
				ve = close;
				j = close + 1;
			} else {
				vs = j;
				for (; j < n; j++) {
					c = html.charCodeAt(j);
					if (c === 62 || (c <= 32 && is_space(c))) break;
				}
				ve = j;
			}
		}
		if (sink !== null && sink(ns, ne, vs, ve, vq) === true) return -2;
	}
}

class Tag implements FoundTag {
	readonly start: number;
	readonly end: number;
	readonly next: number;
	readonly #html: string;
	readonly #after: number;
	#all: Map<string, string> | null = null;
	constructor(start: number, end: number, next: number, html: string, after: number) {
		this.start = start;
		this.end = end;
		this.next = next;
		this.#html = html;
		this.#after = after;
	}

	get attrs(): Map<string, string> {
		if (this.#all !== null) return this.#all;
		const all = new Map<string, string>();
		const html = this.#html;
		read_attrs(html, this.#after, (ns, ne, vs, ve) => {
			const name = html.slice(ns, ne).toLowerCase();
			if (!all.has(name)) all.set(name, html.slice(vs, ve));
		});
		return (this.#all = all);
	}

	attr(name: string): string | undefined {
		if (this.#all !== null) return this.#all.get(name);
		const html = this.#html;
		let out: string | undefined;
		read_attrs(html, this.#after, (ns, ne, vs, ve) => {
			if (!name_is(html, ns, ne, name)) return;
			out = html.slice(vs, ve);
			return true;
		});
		return out;
	}
}

/** The walk's last token (one record, read synchronously right after `step`). */
const TOKEN = {
	/** 1: a start tag, 2: an end tag. */
	kind: 0,
	/** `<` of the tag, where its name starts and ends, and just past its `>`. */
	lt: 0,
	ns: 0,
	ne: 0,
	end: 0
};

/** From `i` (in the data state), read up to the next start or end tag into `TOKEN`; false when
 *  none comes. Comments and bogus comments are stepped over. */
function step(html: string, i: number): boolean {
	const n = html.length;
	while (i < n) {
		const lt = html.indexOf('<', i);
		if (lt === -1) return false;
		const c = html.charCodeAt(lt + 1);
		if (c === 33 /* ! */ && html.startsWith('<!--', lt)) {
			// (`<!-->` and `<!--->` are whole comments; else the first `-->` or `--!>` ends it)
			if (html.charCodeAt(lt + 4) === 62) i = lt + 5;
			else if (html.startsWith('->', lt + 4)) i = lt + 6;
			else {
				// (each `--` in the comment, in order: the first one followed by `>` or `!>` ends it)
				let k = html.indexOf('--', lt + 4);
				for (;;) {
					if (k === -1) return false;
					const e = html.charCodeAt(k + 2);
					if (e === 62) {
						i = k + 3;
						break;
					}
					if (e === 33 && html.charCodeAt(k + 3) === 62) {
						i = k + 4;
						break;
					}
					k = html.indexOf('--', k + 1);
				}
			}
			continue;
		}
		if (c === 33 /* ! */ || c === 63 /* ? */) {
			const gt = html.indexOf('>', lt + 2);
			if (gt === -1) return false;
			i = gt + 1;
			continue;
		}
		if (c === 47 /* / */) {
			const d = html.charCodeAt(lt + 2);
			if (is_letter(d)) {
				const ne = name_end(html, lt + 3);
				const end = read_attrs(html, ne, null);
				if (end === -1) return false;
				TOKEN.kind = 2;
				TOKEN.lt = lt;
				TOKEN.ns = lt + 2;
				TOKEN.ne = ne;
				TOKEN.end = end;
				return true;
			}
			if (d === 62 /* > */) {
				i = lt + 3;
				continue;
			}
			const gt = html.indexOf('>', lt + 2);
			if (gt === -1) return false;
			i = gt + 1;
			continue;
		}
		if (!is_letter(c)) {
			i = lt + 1;
			continue;
		}
		const ne = name_end(html, lt + 2);
		const end = read_attrs(html, ne, null);
		if (end === -1) return false;
		TOKEN.kind = 1;
		TOKEN.lt = lt;
		TOKEN.ns = lt + 1;
		TOKEN.ne = ne;
		TOKEN.end = end;
		return true;
	}
	return false;
}

/** Where the walk goes on after the start tag in `TOKEN`: past its text when it is a raw-text
 *  element (-1 when that text runs to the end), else just past the tag. */
function after_start(html: string): number {
	const raw = raw_name(html, TOKEN.ns, TOKEN.ne);
	if (raw === null) return TOKEN.end;
	return raw_close(html, TOKEN.end, raw);
}

/** Where the attribute `attr` (lower case) of `tag`, a `<name …>` start tag of `html`, has its value
 *  start (inside its quotes), or -1 when it is absent or has no value: where a rewrite of the value
 *  splices. A function, not a `FoundTag` method, so a bundle that never rewrites leaves it out. */
export function value_at(html: string, tag: FoundTag, name: string, attr: string): number {
	let at = -1;
	read_attrs(html, tag.start + 1 + name.length, (ns, ne, vs, _ve, vq) => {
		if (!name_is(html, ns, ne, attr)) return;
		// (a bare attribute has no value to splice into)
		at = vq === -1 ? -1 : vs;
		return true;
	});
	return at;
}

/** The start tag whose name ends at `after` (its `<` at `lt`), up to its `>`. Null when the HTML
 *  ends inside it (an unclosed tag or quoted value), as a browser drops it. */
export function read_tag(html: string, lt: number, after: number): FoundTag | null {
	const end = read_attrs(html, after, null);
	if (end === -1) return null;
	const raw = raw_name(html, lt + 1, after);
	let next = end;
	if (raw !== null) {
		next = raw_close(html, end, raw);
		if (next === -1) next = html.length;
	}
	return new Tag(lt, end, next, html, after);
}

/** The first `<name …>` start tag in `html` from `from` (a point the browser reads as markup: 0,
 *  or a tag's `next`), read the way a browser reads one, or null (none, or the HTML ends inside a
 *  comment, a tag or a raw-text element's text). `next_tag(html, name, t.next)` is the one after
 *  `t`: the loop form of `tags()` for hot paths. */
export function next_tag(html: string, name: string, from: number): FoundTag | null {
	let i = from;
	while (step(html, i)) {
		if (TOKEN.kind === 2) {
			i = TOKEN.end;
			continue;
		}
		if (name_is(html, TOKEN.ns, TOKEN.ne, name)) return read_tag(html, TOKEN.lt, TOKEN.ne);
		i = after_start(html);
		if (i === -1) return null;
	}
	return null;
}

/** Each `<name …>` start tag in `html` from `from`, in order, read the way a browser reads one.
 *  `name` is a tag name (lower case: letters, digits, `-`). */
export function* tags(html: string, name: string, from = 0): Generator<FoundTag> {
	for (let t = next_tag(html, name, from); t !== null; t = next_tag(html, name, t.next)) yield t;
}

/** Where a marker's text sits in `html`, read forward with the tags of one walk: a tag whose span
 *  does not hold it cannot carry the marker, so `holds()` lets a scan read attributes only where it
 *  can be. The needle is what every match spells: a string when the caller compares a value exactly,
 *  a global case-blind pattern when it reads an attribute name (names come in any case). */
export class Needle {
	readonly #html: string;
	readonly #needle: string | RegExp;
	#at = -1;
	/** True once the text appears nowhere from the last tag asked about on: no later tag holds it.
	 *  (A field, not a getter: scans read it once per tag.) */
	gone = true;
	constructor(html: string, needle: string | RegExp, from = 0) {
		this.#html = html;
		this.#needle = needle;
		this.#find(from);
	}

	#find(from: number): void {
		const needle = this.#needle;
		let at: number;
		if (typeof needle === 'string') at = this.#html.indexOf(needle, from);
		else {
			needle.lastIndex = from;
			at = needle.exec(this.#html)?.index ?? -1;
		}
		this.#at = at;
		this.gone = at === -1;
	}

	/** Whether `tag`'s span holds the text. Ask in document order (the tags of one walk). */
	holds(tag: FoundTag): boolean {
		if (this.#at < tag.start) {
			if (this.gone) return false;
			this.#find(tag.start);
			if (this.gone) return false;
		}
		return this.#at < tag.end;
	}
}

/** The text of the element `tag` (named `name`) opens, as written: a raw-text element's (a
 *  `<script>`, a `<style>`) up to the end tag the browser closes it with, any other's (a
 *  `<template>`, the `<head>`) up to its first `</name` outside comments and raw text. Null when it
 *  never closes. */
export function text_of(html: string, tag: FoundTag, name: string): string | null {
	const raw = raw_name(html, tag.start + 1, tag.start + 1 + name.length);
	if (raw !== null) {
		const close = raw_close(html, tag.end, raw);
		return close === -1 ? null : html.slice(tag.end, close);
	}
	// (not raw text: up to its first `</name` the walk reads, past comments and raw text inside)
	for (let i = tag.end; step(html, i);) {
		if (TOKEN.kind === 2 && name_is(html, TOKEN.ns, TOKEN.ne, name))
			return html.slice(tag.end, TOKEN.lt);
		i = TOKEN.kind === 2 ? TOKEN.end : after_start(html);
		if (i === -1) return null;
	}
	return null;
}
