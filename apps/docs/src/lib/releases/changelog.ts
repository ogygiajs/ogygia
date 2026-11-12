/**
 * Reads a package's CHANGELOG.md (as changesets writes it, and the older `## [x.y.z] — date`
 * headings) into releases for the Releases pages. Each change line becomes safe HTML: its text is
 * escaped, and only its own markdown links (http and https), `code`, and **bold** become markup, so
 * a line keeps its PR, commit and author links. "Updated dependencies" lines fold into the release's
 * `deps` (the packages it moved to), without their commit lists.
 */

export type Kind = 'major' | 'minor' | 'patch';

/** One release of one package. */
export type Release = {
	package: string;
	version: string;
	kind: Kind;
	prerelease: boolean;
	/** From a dated heading (`## [0.5.0] — 2026-08-12`); `null` for changesets' plain headings. */
	date: string | null;
	/** Its sections (`Minor Changes`, `Patch Changes`, …), each with its lines as HTML. */
	groups: Array<{ title: string; lines: Array<{ html: string }> }>;
	/** The packages an "Updated dependencies" line moved it to (`@ogygia/core@0.13.0`). */
	deps: string[];
};

/** The releases of one version across packages (the packages release together). */
export type VersionGroup = {
	version: string;
	kind: Kind;
	prerelease: boolean;
	releases: Release[];
};

const VERSION =
	/^##\s+\[?\s*(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*\]?(?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const SECTION = /^###\s+(.+?)\s*$/;
const ITEM = /^[-*]\s+(.*)$/;
const DEP_LINE = /^\s+[-*]\s+(\S+@\S+)\s*$/;

/** The part of `version` that moved: `x.0.0` major (x > 0), `x.y.0` minor, else patch. */
export function kind_of(version: string): Kind {
	const [x, y, z] = version.split('-')[0].split('.').map(Number);
	if (z === 0 && y === 0 && x > 0) return 'major';
	if (z === 0) return 'minor';
	return 'patch';
}

/** Every release in `markdown`, in the order the file lists them (newest first). */
export function read_changelog(pkg: string, markdown: string): Release[] {
	const out: Release[] = [];
	let release: Release | null = null;
	let group: Release['groups'][number] | null = null;
	let in_deps = false;
	for (const line of markdown.split('\n')) {
		const v = VERSION.exec(line);
		if (v) {
			release = {
				package: pkg,
				version: v[1],
				kind: kind_of(v[1]),
				prerelease: v[1].includes('-'),
				date: v[2] ?? null,
				groups: [],
				deps: []
			};
			out.push(release);
			group = null;
			in_deps = false;
			continue;
		}
		if (!release) continue;
		const s = SECTION.exec(line);
		if (s) {
			group = { title: s[1], lines: [] };
			release.groups.push(group);
			in_deps = false;
			continue;
		}
		const dep = in_deps ? DEP_LINE.exec(line) : null;
		if (dep) {
			release.deps.push(dep[1]);
			continue;
		}
		const item = ITEM.exec(line);
		if (item) {
			in_deps = /^Updated dependencies\b/.test(item[1]);
			if (in_deps) continue;
			if (!group) {
				group = { title: 'Changes', lines: [] };
				release.groups.push(group);
			}
			group.lines.push({ html: inline(item[1]) });
			continue;
		}
		// a wrapped line goes on with the item above it
		const last = group?.lines.at(-1);
		if (last && line.startsWith('  ') && line.trim() && !in_deps)
			last.html = `${last.html} ${inline(line.trim())}`;
	}
	for (const r of out) r.groups = r.groups.filter((g) => g.lines.length > 0);
	return out;
}

/** Releases of many packages by version, newest version first; within one, by package name. */
export function group_by_version(releases: Release[]): VersionGroup[] {
	const by = new Map<string, Release[]>();
	for (const r of releases) {
		const list = by.get(r.version);
		if (list) list.push(r);
		else by.set(r.version, [r]);
	}
	return [...by]
		.sort(([a], [b]) => compare_versions(b, a))
		.map(([version, list]) => ({
			version,
			kind: kind_of(version),
			prerelease: version.includes('-'),
			releases: list.sort((a, b) => a.package.localeCompare(b.package))
		}));
}

/** Semver order (a pre-release before its release). */
export function compare_versions(a: string, b: string): number {
	const [av, ap = ''] = a.split(/-(.*)/s);
	const [bv, bp = ''] = b.split(/-(.*)/s);
	const an = av.split('.').map(Number);
	const bn = bv.split('.').map(Number);
	for (let i = 0; i < 3; i++) if (an[i] !== bn[i]) return an[i] - bn[i];
	if (ap === bp) return 0;
	if (!ap) return 1;
	if (!bp) return -1;
	return ap.localeCompare(bp, 'en', { numeric: true });
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }; // static: four characters
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** A line's own markdown: links (http/https only), `code`, **bold**; everything else escaped. */
function inline(md: string): string {
	let out = '';
	let i = 0;
	while (i < md.length) {
		const c = md[i];
		if (c === '`') {
			const end = md.indexOf('`', i + 1);
			if (end > i) {
				out = `${out}<code>${escape(md.slice(i + 1, end))}</code>`;
				i = end + 1;
				continue;
			}
		}
		if (c === '*' && md[i + 1] === '*') {
			const end = md.indexOf('**', i + 2);
			if (end > i) {
				out = `${out}<strong>${inline(md.slice(i + 2, end))}</strong>`;
				i = end + 2;
				continue;
			}
		}
		if (c === '[') {
			const link = read_link(md, i);
			if (link) {
				const text = inline(link.text);
				out += /^https?:\/\//.test(link.href) ? `<a href="${escape(link.href)}">${text}</a>` : text;
				i = link.end;
				continue;
			}
		}
		out += escape(c);
		i++;
	}
	return out;
}

/** `[text](href)` at `at` (the text may hold one level of `[…]`), or `null`. */
function read_link(md: string, at: number): { text: string; href: string; end: number } | null {
	let depth = 0;
	let j = at;
	for (; j < md.length; j++) {
		if (md[j] === '[') depth++;
		else if (md[j] === ']' && --depth === 0) break;
	}
	if (j >= md.length || md[j + 1] !== '(') return null;
	const close = md.indexOf(')', j + 2);
	if (close === -1) return null;
	return { text: md.slice(at + 1, j), href: md.slice(j + 2, close), end: close + 1 };
}
