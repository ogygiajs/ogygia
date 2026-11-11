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
	readonly attrs: Map<string, string>;
	/** One attribute's value (`''` when bare; the first one wins), or undefined. `name` in lower case. */
	attr(name: string): string | undefined;
	/** Where that attribute's value starts in the HTML (inside its quotes), or -1 when the attribute
	 *  is absent or has no value: where a rewrite of the value splices. */
	value_at(name: string): number;
}

/** One attribute (or the tag's `>`) at `lastIndex`: `>` | name, then `="…"` | `='…'` | `=bare`.
 *  Sticky, read synchronously only (nothing yields between a set and a read). */
const ATTR =
	/[\t\n\f\r /]*(?:(>)|([^\t\n\f\r />=]*)[\t\n\f\r ]*(?:=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|(?!["'])([^\t\n\f\r >]*)))?)/y;

// `ATTR` cut at attribute starts: one attribute and the gap after it, from where its name starts.
// Wrapped as `(?=(STEP))\1` it is atomic (a lookahead never backtracks), so a run of them walks a
// tag's attributes in one pass, linear even when the tag never closes.
const STEP = String.raw`[^\t\n\f\r />=]*[\t\n\f\r ]*(?:=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|(?!["'])[^\t\n\f\r >]*))?[\t\n\f\r /]*`;

/** From where a tag's name ends: every attribute, then its `>`. No match: the HTML ends inside it
 *  (an unclosed tag, or a `=` whose quote never closes). One search per tag. */
const TAG_END = new RegExp(String.raw`[\t\n\f\r /]*(?:(?=(${STEP}))\1)*>`, 'y');

// One pattern per attribute name asked for (code literals: a handful): from where the tag's name
// ends, the attributes before the first one named so (any case), then its value; or the tag's `>`.
const ATTR_NAMED = new Map<string, RegExp>();

/** `name` as a pattern in any case, spelled out per letter (`[rR][eE][lL]`): a case-blind flag would
 *  also make the walk's backreference case-blind, which is far slower. */
function any_case(name: string): string {
	const upper = name.toUpperCase();
	let out = '';
	for (let i = 0; i < name.length; i++)
		out += name[i] === upper[i] ? name[i] : `[${name[i]}${upper[i]}]`;
	return out;
}

function attr_named(name: string): RegExp {
	let re = ATTR_NAMED.get(name);
	if (re === undefined)
		ATTR_NAMED.set(
			name,
			(re = new RegExp(
				String.raw`[\t\n\f\r /]*(?:(?=(${STEP}))\1)*?(?:>|${any_case(name)}(?=[\t\n\f\r />=])[\t\n\f\r ]*(?:=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|(?!["'])([^\t\n\f\r >]*)))?())`,
				'y'
			))
		);
	return re;
}

class Tag implements FoundTag {
	readonly start: number;
	readonly end: number;
	readonly #html: string;
	readonly #after: number;
	#all: Map<string, string> | null = null;
	constructor(start: number, end: number, html: string, after: number) {
		this.start = start;
		this.end = end;
		this.#html = html;
		this.#after = after;
	}

	get attrs(): Map<string, string> {
		if (this.#all !== null) return this.#all;
		const all = new Map<string, string>();
		const html = this.#html;
		ATTR.lastIndex = this.#after;
		// (the tag is known closed: every step reads an attribute until its `>`)
		for (let m = ATTR.exec(html)!; m[1] === undefined; m = ATTR.exec(html)!) {
			const attr = m[2].toLowerCase();
			if (!all.has(attr)) all.set(attr, m[3] ?? m[4] ?? m[5] ?? '');
		}
		return (this.#all = all);
	}

	attr(name: string): string | undefined {
		if (this.#all !== null) return this.#all.get(name);
		const re = attr_named(name);
		re.lastIndex = this.#after;
		// (the tag is known closed: it always matches, at the latest at its `>`)
		const m = re.exec(this.#html)!;
		return m[5] === undefined ? undefined : (m[2] ?? m[3] ?? m[4] ?? '');
	}

	value_at(name: string): number {
		const re = attr_named(name);
		re.lastIndex = this.#after;
		const m = re.exec(this.#html)!;
		if (m[5] === undefined) return -1;
		// (the match ends past the value, and past its closing quote when quoted)
		if (m[4] !== undefined) return re.lastIndex - m[4].length;
		const quoted = m[2] ?? m[3];
		return quoted === undefined ? -1 : re.lastIndex - quoted.length - 1;
	}
}

/** The start tag whose name ends at `after` (its `<` at `lt`), up to its `>`. Null when the HTML
 *  ends inside it (an unclosed tag or quoted value), as a browser drops it. */
export function read_tag(html: string, lt: number, after: number): FoundTag | null {
	TAG_END.lastIndex = after;
	return TAG_END.test(html) ? new Tag(lt, TAG_END.lastIndex, html, after) : null;
}

// The open and close patterns per tag name, made once (the names are code literals: a handful).
// Shared, so every reader sets `lastIndex` right before its synchronous test.
const OPEN = new Map<string, RegExp>();
const CLOSE = new Map<string, RegExp>();

/** A comment, or `<name` ending where a tag name ends. */
function open_of(name: string): RegExp {
	let re = OPEN.get(name);
	if (re === undefined)
		OPEN.set(name, (re = new RegExp(`<!--|<${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')));
	return re;
}

/** The first `<name …>` start tag in `html` from `from`, read the way a browser reads one, or null
 *  (none, or the HTML ends inside a comment or the tag). `next_tag(html, name, t.end)` is the one
 *  after `t`: the loop form of `tags()` for hot paths. */
export function next_tag(html: string, name: string, from: number): FoundTag | null {
	const open = open_of(name);
	let at = from;
	for (;;) {
		open.lastIndex = at;
		if (!open.test(html)) return null;
		const after = open.lastIndex;
		// (a tag name holds no `<` or `!`: four characters `<!--` before the match's end are a comment)
		if (html.startsWith('<!--', after - 4)) {
			const close = html.indexOf('-->', after);
			if (close === -1) return null;
			at = close + 3;
			continue;
		}
		return read_tag(html, after - name.length - 1, after);
	}
}

/** Each `<name …>` start tag in `html` from `from`, in order, read the way a browser reads one.
 *  `name` is a tag name (letters, digits, `-`). */
export function* tags(html: string, name: string, from = 0): Generator<FoundTag> {
	for (let t = next_tag(html, name, from); t !== null; t = next_tag(html, name, t.end)) yield t;
}

/** The raw text of the element `tag` opens (a `<script>`, `<style>`, `<template>`): up to its first
 *  `</name`, as a browser ends raw text. Null when it never closes. */
export function text_of(html: string, tag: FoundTag, name: string): string | null {
	let close = CLOSE.get(name);
	if (close === undefined)
		CLOSE.set(name, (close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')));
	close.lastIndex = tag.end;
	if (!close.test(html)) return null;
	return html.slice(tag.end, close.lastIndex - name.length - 2);
}
