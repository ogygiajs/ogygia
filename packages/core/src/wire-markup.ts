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
 * - `tags()` reads tags the way a browser does (./markup-walk.ts, re-exported here).
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
	| 'dt'
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
export const OG_DT = 'data-og-dt';
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
	dt: { attr: OG_DT, by: 'page' },
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

// THE TAG WALK lives in ./markup-walk.ts (its own module, so the boot never fetches it), and is
// read through here like the rest of the markup.
export * from './markup-walk.ts';
