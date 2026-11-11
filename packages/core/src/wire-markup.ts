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

/** Every marker, once. A key not in `MarkKey` (or a `MarkKey` missing here) does not compile. */
export const MARK: { readonly [K in MarkKey]: Mark } = {
	baked: { attr: 'data-og-baked', by: 'page' },
	box: { attr: 'data-og-box', by: 'devtools' },
	cpu: { attr: 'data-og-cpu', by: 'devtools' },
	cpuFns: { attr: 'data-og-cpu-fns', by: 'devtools' },
	cpuRecord: { attr: 'data-og-cpu-record', by: 'devtools' },
	csrNotice: { attr: 'data-og-csr-notice', by: 'devtools' },
	detail: { attr: 'data-og-detail', by: 'devtools' },
	detailBarrel: { attr: 'data-og-detail-barrel', by: 'devtools' },
	detailBrowser: { attr: 'data-og-detail-browser', by: 'devtools' },
	detailBytes: { attr: 'data-og-detail-bytes', by: 'devtools' },
	detailHazard: { attr: 'data-og-detail-hazard', by: 'devtools' },
	detailServer: { attr: 'data-og-detail-server', by: 'devtools' },
	detailSession: { attr: 'data-og-detail-session', by: 'devtools' },
	detailTop: { attr: 'data-og-detail-top', by: 'devtools' },
	detailTwice: { attr: 'data-og-detail-twice', by: 'devtools' },
	dtIngested: { attr: 'data-og-dt-ingested', by: 'page' },
	exp: { attr: 'data-og-exp', by: 'page' },
	format: { attr: 'data-og-format', by: 'page' },
	fp: { attr: 'data-og-fp', by: 'page' },
	head: { attr: 'data-og-head', by: 'page' },
	healed: { attr: 'data-og-healed', by: 'page' },
	hide: { attr: 'data-og-hide', by: 'devtools' },
	highlight: { attr: 'data-og-highlight', by: 'devtools' },
	hole: { attr: 'data-og-hole', by: 'page' },
	holeFailed: { attr: 'data-og-hole-failed', by: 'devtools' },
	html: { attr: 'data-og-html', by: 'page' },
	hydWindow: { attr: 'data-og-hyd-window', by: 'devtools' },
	hydration: { attr: 'data-og-hydration', by: 'devtools' },
	kept: { attr: 'data-og-kept', by: 'page' },
	late: { attr: 'data-og-late', by: 'page' },
	lateBoot: { attr: 'data-og-late-boot', by: 'page' },
	lateError: { attr: 'data-og-late-error', by: 'page' },
	ledgerExact: { attr: 'data-og-ledger-exact', by: 'devtools' },
	ledgerShared: { attr: 'data-og-ledger-shared', by: 'devtools' },
	ledgerTwice: { attr: 'data-og-ledger-twice', by: 'devtools' },
	len: { attr: 'data-og-len', by: 'page' },
	locations: { attr: 'data-og-locations', by: 'page' },
	mountFailed: { attr: 'data-og-mount-failed', by: 'page' },
	mountFallback: { attr: 'data-og-mount-fallback', by: 'page' },
	mountMoved: { attr: 'data-og-mount-moved', by: 'page' },
	moved: { attr: 'data-og-moved', by: 'page' },
	noReconcile: { attr: 'data-og-no-reconcile', by: 'page' },
	opaque: { attr: 'data-og-opaque', by: 'page' },
	opaquen: { attr: 'data-og-opaquen', by: 'page' },
	overlay: { attr: 'data-og-overlay', by: 'devtools' },
	overlayToggle: { attr: 'data-og-overlay-toggle', by: 'devtools' },
	pageBrowserLimits: { attr: 'data-og-page-browser-limits', by: 'devtools' },
	pageFindings: { attr: 'data-og-page-findings', by: 'devtools' },
	pageHoles: { attr: 'data-og-page-holes', by: 'devtools' },
	pageKept: { attr: 'data-og-page-kept', by: 'devtools' },
	pageNav: { attr: 'data-og-page-nav', by: 'devtools' },
	pageServer: { attr: 'data-og-page-server', by: 'devtools' },
	pageSince: { attr: 'data-og-page-since', by: 'devtools' },
	pageSinceNote: { attr: 'data-og-page-since-note', by: 'devtools' },
	pageSincePart: { attr: 'data-og-page-since-part', by: 'devtools' },
	pageStyles: { attr: 'data-og-page-styles', by: 'devtools' },
	pageUnmeasured: { attr: 'data-og-page-unmeasured', by: 'devtools' },
	pageUnscoped: { attr: 'data-og-page-unscoped', by: 'devtools' },
	panelToggle: { attr: 'data-og-panel-toggle', by: 'devtools' },
	pick: { attr: 'data-og-pick', by: 'devtools' },
	profileAnchors: { attr: 'data-og-profile-anchors', by: 'devtools' },
	profileAssets: { attr: 'data-og-profile-assets', by: 'devtools' },
	profileFindings: { attr: 'data-og-profile-findings', by: 'devtools' },
	profileHead: { attr: 'data-og-profile-head', by: 'devtools' },
	profileHot: { attr: 'data-og-profile-hot', by: 'devtools' },
	profileIslands: { attr: 'data-og-profile-islands', by: 'devtools' },
	profileRun: { attr: 'data-og-profile-run', by: 'devtools' },
	profileScore: { attr: 'data-og-profile-score', by: 'devtools' },
	profiler: { attr: 'data-og-profiler', by: 'devtools' },
	props: { attr: 'data-og-props', by: 'devtools' },
	recovered: { attr: 'data-og-recovered', by: 'page' },
	restore: { attr: 'data-og-restore', by: 'page' },
	session: { attr: 'data-og-session', by: 'devtools' },
	sessionBrowserLimits: { attr: 'data-og-session-browser-limits', by: 'devtools' },
	sessionFindings: { attr: 'data-og-session-findings', by: 'devtools' },
	sessionProfile: { attr: 'data-og-session-profile', by: 'devtools' },
	sessionRequests: { attr: 'data-og-session-requests', by: 'devtools' },
	sessionServer: { attr: 'data-og-session-server', by: 'devtools' },
	sessionServerState: { attr: 'data-og-session-server-state', by: 'devtools' },
	sessionServerToggle: { attr: 'data-og-session-server-toggle', by: 'devtools' },
	sessionStart: { attr: 'data-og-session-start', by: 'devtools' },
	sessionStop: { attr: 'data-og-session-stop', by: 'devtools' },
	sessionTimeline: { attr: 'data-og-session-timeline', by: 'devtools' },
	sessionWindow: { attr: 'data-og-session-window', by: 'devtools' },
	shared: { attr: 'data-og-shared', by: 'page' },
	skipped: { attr: 'data-og-skipped', by: 'page' },
	slot: { attr: 'data-og-slot', by: 'page' },
	standIns: { attr: 'data-og-stand-ins', by: 'page' },
	static: { attr: 'data-og-static', by: 'page' },
	stitched: { attr: 'data-og-stitched', by: 'page' },
	stub: { attr: 'data-og-stub', by: 'docs' },
	tab: { attr: 'data-og-tab', by: 'devtools' },
	vitals: { attr: 'data-og-vitals', by: 'devtools' },
	win: { attr: 'data-og-win', by: 'devtools' },
	wire: { attr: 'data-og-wire', by: 'page' },
	woke: { attr: 'data-og-woke', by: 'page' },
	ogygiaAnnouncer: { attr: 'data-ogygia-announcer', by: 'page' },
	ogygiaBeacon: { attr: 'data-ogygia-beacon', by: 'devtools' },
	ogygiaDevHmr: { attr: 'data-ogygia-dev-hmr', by: 'page' },
	ogygiaDevtoolsBoot: { attr: 'data-ogygia-devtools-boot', by: 'page' },
	ogygiaDevtoolsHost: { attr: 'data-ogygia-devtools-host', by: 'devtools' },
	ogygiaFnm: { attr: 'data-ogygia-fnm', by: 'page' },
	ogygiaGraph: { attr: 'data-ogygia-graph', by: 'page' },
	ogygiaGraphPreload: { attr: 'data-ogygia-graph-preload', by: 'page' },
	ogygiaHoles: { attr: 'data-ogygia-holes', by: 'page' },
	ogygiaKeep: { attr: 'data-ogygia-keep', by: 'page' },
	ogygiaNoKeep: { attr: 'data-ogygia-no-keep', by: 'page' },
	ogygiaPage: { attr: 'data-ogygia-page', by: 'page' },
	ogygiaProps: { attr: 'data-ogygia-props', by: 'page' },
	ogygiaProvide: { attr: 'data-ogygia-provide', by: 'page' },
	ogygiaProvidePage: { attr: 'data-ogygia-provide-page', by: 'page' },
	ogygiaRcss: { attr: 'data-ogygia-rcss', by: 'page' },
	ogygiaRegionCss: { attr: 'data-ogygia-region-css', by: 'page' },
	ogygiaRemote: { attr: 'data-ogygia-remote', by: 'page' },
	ogygiaRuntime: { attr: 'data-ogygia-runtime', by: 'page' },
	ogygiaRuntimeDep: { attr: 'data-ogygia-runtime-dep', by: 'page' },
	ogygiaSlot: { attr: 'data-ogygia-slot', by: 'page' },
	ogygiaSpeculate: { attr: 'data-ogygia-speculate', by: 'page' },
	ogygiaSpeculateHint: { attr: 'data-ogygia-speculate-hint', by: 'page' }
} as const satisfies Record<string, Mark>;

// static: every declared marker's name, made once from MARK
const DECLARED: ReadonlySet<string> = new Set(Object.values(MARK).map((m) => m.attr));

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
 *  lower case, a bare attribute's value `''`). */
export interface FoundTag {
	readonly start: number;
	readonly end: number;
	readonly attrs: Map<string, string>;
}

/** One attribute (or the tag's `>`) at `lastIndex`: `>` | name, then `="…"` | `='…'` | `=bare`.
 *  Sticky, read synchronously inside `read_tag` only (it never yields between a set and a read). */
const ATTR =
	/[\t\n\f\r /]*(?:(>)|([^\t\n\f\r />=]*)[\t\n\f\r ]*(?:=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|(?!["'])([^\t\n\f\r >]*)))?)/y;

/** The start tag whose name ends at `after` (its `<` at `lt`): its attributes up to its `>`. Null
 *  when the HTML ends inside it (an unclosed tag or quoted value), as a browser drops it. */
export function read_tag(html: string, lt: number, after: number): FoundTag | null {
	const attrs = new Map<string, string>(); // (one per tag, not module-level)
	ATTR.lastIndex = after;
	for (;;) {
		const m = ATTR.exec(html)!; // (every part is optional: it always matches)
		if (m[1] !== undefined) return { start: lt, end: ATTR.lastIndex, attrs };
		const value = m[3] ?? m[4] ?? m[5];
		// no value read and a `=` next: its quote never closes
		if (value === undefined && html.charCodeAt(ATTR.lastIndex) === 61) return null;
		// no name and no value: the HTML ended inside the tag
		if (value === undefined && m[2] === '') return null;
		const attr = m[2].toLowerCase();
		if (!attrs.has(attr)) attrs.set(attr, value ?? '');
	}
}

/** Each `<name …>` start tag in `html` from `from`, in order, read the way a browser reads one.
 *  `name` is a tag name (letters, digits, `-`). */
export function* tags(html: string, name: string, from = 0): Generator<FoundTag> {
	// a comment, or `<name` ending where a tag name ends (one per scan: no shared lastIndex)
	const open = new RegExp(`<!--|<${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi');
	open.lastIndex = from;
	for (let m = open.exec(html); m !== null; m = open.exec(html)) {
		if (m[0] === '<!--') {
			const close = html.indexOf('-->', m.index + 4);
			if (close === -1) return;
			open.lastIndex = close + 3;
			continue;
		}
		const tag = read_tag(html, m.index, open.lastIndex);
		if (tag === null) return;
		yield tag;
		open.lastIndex = tag.end;
	}
}

/** The raw text of the element `tag` opens (a `<script>`, `<style>`, `<template>`): up to its first
 *  `</name`, as a browser ends raw text. Null when it never closes. */
export function text_of(html: string, tag: FoundTag, name: string): string | null {
	const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi');
	close.lastIndex = tag.end;
	const m = close.exec(html);
	return m === null ? null : html.slice(tag.end, m.index);
}
