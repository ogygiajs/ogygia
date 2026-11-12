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
	| 'mark'
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
	fragmentFailed: { attr: 'data-og-fragment-failed', by: 'page' },
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
	mark: { attr: 'data-og-mark', by: 'page' },
	mountFailed: { attr: 'data-og-mount-failed', by: 'page' },
	mountFallback: { attr: 'data-og-mount-fallback', by: 'page' },
	mountMoved: { attr: 'data-og-mount-moved', by: 'page' },
	moved: { attr: 'data-og-moved', by: 'page' },
	noReconcile: { attr: 'data-og-no-reconcile', by: 'page' },
	opaque: { attr: 'data-og-opaque', by: 'page' },
	opaquen: { attr: 'data-og-opaquen', by: 'page' },
	overlay: { attr: 'data-og-overlay', by: 'devtools' },
	overlayToggle: { attr: 'data-og-overlay-toggle', by: 'devtools' },
	owner: { attr: 'data-og-owner', by: 'page' },
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

/** HTML's whitespace inside a tag: tab, LF, FF, CR, space (NaN, past the end, is not). */
function is_space(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

/** `[A-Za-z]`: what starts a tag name (`<3` and `< p` are text). */
function is_letter(c: number): boolean {
	return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

/** The elements whose text the tokenizer reads raw, up to their own end tag: no tag, no comment
 *  inside. (`script` has its own escape rules: `skip_script`.) */
const RAW_TEXT = new Set([
	'style',
	'textarea',
	'title',
	'xmp',
	'iframe',
	'noembed',
	'noframes',
	'noscript'
]);

/** Does `</name` (any case) followed by whitespace, `/` or `>` start at `at`: the end tag that
 *  closes a raw-text element? */
function closes(html: string, at: number, name: string): boolean {
	return (
		html.charCodeAt(at) === 60 &&
		html.charCodeAt(at + 1) === 47 &&
		html.slice(at + 2, at + 2 + name.length).toLowerCase() === name &&
		(is_space(html.charCodeAt(at + 2 + name.length)) ||
			html[at + 2 + name.length] === '/' ||
			html[at + 2 + name.length] === '>')
	);
}

/** Where the end tag of a raw-text element `name` whose text starts at `from` begins (-1: none). */
function skip_raw(html: string, from: number, name: string): number {
	for (let at = html.indexOf('</', from); at !== -1; at = html.indexOf('</', at + 2))
		if (closes(html, at, name)) return at;
	return -1;
}

/** Does `<script` (any case) followed by whitespace, `/` or `>` start at `at`? */
function opens_script(html: string, at: number): boolean {
	const c = html[at + 7];
	return (
		html.slice(at + 1, at + 7).toLowerCase() === 'script' &&
		(c === '/' || c === '>' || is_space(html.charCodeAt(at + 7)))
	);
}

/**
 * Where the `</script` that ends a script's text (from `from`) begins (-1: none), by the
 * tokenizer's script-data states: after `<!--` the text is ESCAPED until `-->`, and an escaped
 * `<script` opens a DOUBLE-ESCAPED run where `</script` does not end the script (it returns to
 * escaped).
 */
function skip_script(html: string, from: number): number {
	let i = from;
	for (;;) {
		// script data: a `<!--` escapes, a `</script` ends
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
			if (open !== -1 && (dash === -1 || open < dash)) {
				if (closes(html, open, 'script')) return open;
				if (!opens_script(html, open)) {
					j = open + 1;
					continue;
				}
				// double escaped: `-->` returns to script data, `</script` to escaped
				let k = open + 7;
				for (;;) {
					const d = html.indexOf('-->', k);
					const c = html.indexOf('</', k);
					if (c !== -1 && (d === -1 || c < d) && closes(html, c, 'script')) {
						j = c + 8;
						break;
					}
					if (d === -1 && c === -1) return -1;
					if (d !== -1 && (c === -1 || d < c)) {
						j = -1;
						i = d + 3;
						break;
					}
					k = c + 2;
				}
				if (j === -1) break;
				continue;
			}
			if (dash === -1) return -1;
			i = dash + 3;
			break;
		}
	}
}

/**
 * Read a tag's attributes from `j` (just past its name) to its `>`, into `attrs` (null: an end tag,
 * read only to find its end). Returns the index just past the `>`, or -1 when the input ends inside
 * the tag (the browser drops it). Names fold to lower case; a quoted value may hold `>` and the
 * other quote; an unquoted one ends at whitespace or `>`; of two same-name attributes the first
 * counts; values are kept as written.
 */
function read_attrs(html: string, j: number, attrs: Map<string, string> | null): number {
	const n = html.length;
	for (;;) {
		while (j < n && (is_space(html.charCodeAt(j)) || html[j] === '/')) j++;
		if (j >= n) return -1;
		if (html[j] === '>') return j + 1;
		// (the first character is the name's, even when it is `=`)
		const name_start = j++;
		while (j < n) {
			const c = html[j];
			if (c === '=' || c === '>' || c === '/' || is_space(html.charCodeAt(j))) break;
			j++;
		}
		const name_end = j;
		while (j < n && is_space(html.charCodeAt(j))) j++;
		let value = '';
		if (html[j] === '=') {
			j++;
			while (j < n && is_space(html.charCodeAt(j))) j++;
			const q = html[j];
			if (q === '"' || q === "'") {
				const close = html.indexOf(q, j + 1);
				if (close === -1) return -1;
				value = html.slice(j + 1, close);
				j = close + 1;
			} else {
				const v = j;
				while (j < n && html[j] !== '>' && !is_space(html.charCodeAt(j))) j++;
				value = html.slice(v, j);
			}
		}
		if (attrs) {
			const name = html.slice(name_start, name_end).toLowerCase();
			if (!attrs.has(name)) attrs.set(name, value);
		}
	}
}

/**
 * Each `<name …>` start tag in `html`, in order, read the way a browser's tokenizer reads one: no
 * tag inside a comment (`<!-->` and `--!>` end one too), a bogus comment (`<!x …>`, `<?x …>`,
 * CDATA), an end tag's attribute values, or the text of a raw-text element (script, style,
 * textarea, title…, up to its own end tag). Pinned against parse5 by
 * test/wire-markup-differential.test.ts. (Foreign content is not modelled: an `<svg>`'s `<style>`
 * is read as raw text, as in HTML.)
 */
export function* tags(html: string, name: string): Generator<FoundTag> {
	const want = name.toLowerCase();
	const n = html.length;
	let i = 0;
	while (i < n) {
		const lt = html.indexOf('<', i);
		if (lt === -1) return;
		const c = html.charCodeAt(lt + 1);
		if (c === 33 /* ! */ && html.startsWith('<!--', lt)) {
			// (`<!-->` and `<!--->` are whole comments; else the first `-->` or `--!>` ends it)
			if (html[lt + 4] === '>') i = lt + 5;
			else if (html.startsWith('->', lt + 4)) i = lt + 6;
			else {
				const a = html.indexOf('-->', lt + 4);
				const b = html.indexOf('--!>', lt + 4);
				if (a === -1 && b === -1) return;
				i = b !== -1 && (a === -1 || b < a) ? b + 4 : a + 3;
			}
			continue;
		}
		if (c === 33 /* ! */ || c === 63 /* ? */) {
			// a bogus comment (a doctype, CDATA, a processing instruction): to the first `>`
			const gt = html.indexOf('>', lt + 2);
			if (gt === -1) return;
			i = gt + 1;
			continue;
		}
		if (c === 47 /* / */) {
			const d = html.charCodeAt(lt + 2);
			if (is_letter(d)) {
				// an end tag: its "attributes" are read (quotes and all) only to find its `>`
				let j = lt + 3;
				while (j < n && html[j] !== '>' && html[j] !== '/' && !is_space(html.charCodeAt(j))) j++;
				const end = read_attrs(html, j, null);
				if (end === -1) return;
				i = end;
			} else if (d === 62 /* > */) i = lt + 3;
			else {
				const gt = html.indexOf('>', lt + 2);
				if (gt === -1) return;
				i = gt + 1;
			}
			continue;
		}
		if (!is_letter(c)) {
			i = lt + 1;
			continue;
		}
		let j = lt + 2;
		while (j < n && html[j] !== '>' && html[j] !== '/' && !is_space(html.charCodeAt(j))) j++;
		const tag = html.slice(lt + 1, j).toLowerCase();
		// (one map per wanted tag, not module-level; any other tag is read only to find its end)
		const attrs = tag === want ? new Map<string, string>() : null;
		const end = read_attrs(html, j, attrs);
		if (end === -1) return;
		if (attrs) yield { start: lt, end, attrs };
		i = end;
		if (tag === 'script') i = skip_script(html, end);
		else if (tag === 'plaintext') return;
		else if (RAW_TEXT.has(tag)) i = skip_raw(html, end, tag);
		if (i === -1) return;
	}
}
