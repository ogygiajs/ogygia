/**
 * STANDALONE REPORT — one HTML file that opens from disk, islands and all.
 *
 * The report page is an ogygia document: server markup, a runtime `<script type="module" src>`,
 * `<ogygia-region entry="…">` islands whose chunks are `import()`ed by URL, stylesheet links. None
 * of that survives `file://`. This turns it into a single file:
 *
 *   • every stylesheet link becomes a `<style>`;
 *   • every JS chunk the page can reach (the runtime, each island entry, and everything they
 *     import, transitively) is fetched once, its relative imports rewritten to bare `og:<path>`
 *     specifiers, and shipped as a `data:` URL in ONE import map — dynamic `import('og:…')` from
 *     the runtime resolves through the map, so islands hydrate exactly as on the server;
 *   • the runtime script is inlined as a module; modulepreload hints are dropped (nothing to fetch);
 *   • island `entry` attributes are rewritten to their `og:` keys.
 *
 * Pure: the caller supplies `load(url)` (a self-fetch in the profiler host, a map in tests). Dev
 * servers are refused upstream — their module graph is Vite's, not a bundle.
 */

import { head_end, next_tag, value_at, type FoundTag } from '@ogygia/core/internal/server';

export interface StandaloneOptions {
	/** the report page's own URL (relative hrefs resolve against it) */
	page_url: string;
	/** fetch a same-origin asset by absolute URL; `null` when it cannot be read */
	load: (url: string) => Promise<string | null>;
	/** refuse past this many bytes of inlined assets (a runaway graph) */
	max_bytes?: number;
}

// (a `rel` holds a token as a browser reads it: split on spaces, in any case)
const STYLESHEET_REL = /(?:^|[\t\n\f\r ])stylesheet(?:[\t\n\f\r ]|$)/i;
const MODULEPRELOAD_REL = /(?:^|[\t\n\f\r ])modulepreload(?:[\t\n\f\r ]|$)/i;
const SCRIPT_CLOSE = '</script>';
const WS_G = /\s+/g;

/** One rewrite of `html`: `[at, end)` becomes `text`. */
interface Splice {
	at: number;
	end: number;
	text: string;
}

function apply(html: string, splices: Splice[]): string {
	let out = '';
	let pos = 0;
	for (const s of splices) {
		out += html.slice(pos, s.at) + s.text;
		pos = s.end;
	}
	return out + html.slice(pos);
}

/** Every `<name>` start tag of `html`, in order. */
function all_tags(html: string, name: string): FoundTag[] {
	const out: FoundTag[] = [];
	for (let t = next_tag(html, name, 0); t !== null; t = next_tag(html, name, t.next)) out.push(t);
	return out;
}

/** Where the attribute `attr` of `t` (a `<name …>` tag) is written, name through value (and its
 *  closing quote), or null when it is absent or bare. */
function attr_span(html: string, t: FoundTag, name: string, attr: string): [number, number] | null {
	const value = t.attr(attr);
	const at = value === undefined ? -1 : value_at(html, t, name, attr);
	if (at === -1) return null;
	const q = html.charCodeAt(at - 1);
	const quoted = q === 34 || q === 39;
	let from = quoted ? at - 2 : at - 1;
	while (html.charCodeAt(from) !== 61) from--; // back to its `=`
	from--;
	for (let c = html.charCodeAt(from); c === 32 || (c >= 9 && c <= 13); c = html.charCodeAt(from))
		from--;
	return [from - attr.length + 1, at + value!.length + (quoted ? 1 : 0)];
}

/** `html` with `text` put where its head ends (unchanged when it has no head end). */
function before_head_end(html: string, text: string): string {
	const at = head_end(html);
	return at === -1 ? html : html.slice(0, at) + text + html.slice(at);
}
/** a static or dynamic import of a RELATIVE specifier inside a built chunk — quoted, or a
 *  template literal with no interpolation (Vite emits `import(\`./chunks/x.js\`)`) */
const IMPORT_RE = /((?:\bfrom|\bimport)\s*\(?\s*)(["'`])(\.{1,2}\/[^"'`$]+)\2/g;
/** any other relative chunk path in a string: Vite's `__vite__mapDeps` preload list. Pointed at
 *  the same keys so a preload link never resolves against the document (a `file://` fetch). */
const DEP_STRING_RE = /(["'])(\.{1,2}\/[^"'`\s]+\.(?:js|css))\1/g;

/** The import-map key for a chunk. An absolute URL with a `//` authority on purpose: the runtime's
 *  `island_module_url` hands an `entry` with a URL scheme through untouched (a bare `og:/x` would
 *  be resolved against the document and lose the scheme), and a `data:` module can import an
 *  absolute URL where it cannot import a relative one. */
const key_of = (u: URL) => `og://chunks${u.pathname}`;

export async function build_standalone(html: string, opts: StandaloneOptions): Promise<string> {
	const base = new URL(opts.page_url);
	const max = opts.max_bytes ?? 12 * 1024 * 1024;
	let bytes = 0;
	const chunks = new Map<string, string>(); // og:key → rewritten source
	const missing: string[] = [];

	const fetch_text = async (u: URL): Promise<string | null> => {
		const text = await opts.load(u.href);
		if (text === null) {
			missing.push(u.pathname);
			return null;
		}
		bytes += text.length;
		if (bytes > max)
			throw new Error(
				`standalone report would exceed ${Math.round(max / 1048576)} MB of inlined assets`
			);
		return text;
	};

	/** rewrite a chunk's relative imports to `og:` keys and pull those chunks in too */
	const add_chunk = async (u: URL): Promise<string> => {
		const key = key_of(u);
		const have = chunks.get(key);
		if (have !== undefined) return key;
		chunks.set(key, ''); // mark before recursing (cycles)
		const src = await fetch_text(u);
		if (src === null) return key;
		const deps: URL[] = [];
		const rewritten = src
			.replace(IMPORT_RE, (_, lead: string, q: string, spec: string) => {
				const dep = new URL(spec, u);
				deps.push(dep);
				return `${lead}${q}${key_of(dep)}${q}`;
			})
			.replace(DEP_STRING_RE, (_, q: string, spec: string) => {
				const dep = new URL(spec, u);
				if (spec.endsWith('.js')) deps.push(dep);
				return `${q}${key_of(dep)}${q}`;
			});
		chunks.set(key, rewritten);
		for (const dep of deps) await add_chunk(dep);
		return key;
	};

	// 1. stylesheets → <style>
	const sheets: { t: FoundTag; url: URL }[] = [];
	for (const t of all_tags(html, 'link')) {
		if (!STYLESHEET_REL.test(t.attr('rel') ?? '')) continue;
		const href = t.attr('href');
		if (href) sheets.push({ t, url: new URL(href, base) });
	}
	const styles: Splice[] = [];
	for (const s of sheets) {
		const css = await fetch_text(s.url);
		styles.push({
			at: s.t.start,
			end: s.t.end,
			text:
				css === null
					? ''
					: `<style data-standalone="${s.url.pathname}">${css.replaceAll('</style', '<\\/style')}</style>`
		});
	}
	html = apply(html, styles);
	// 2. modulepreload hints: nothing to preload from a file
	html = apply(
		html,
		all_tags(html, 'link')
			.filter((t) => MODULEPRELOAD_REL.test(t.attr('rel') ?? ''))
			.map((t) => ({ at: t.start, end: t.end, text: '' }))
	);
	// 3. module scripts with a src (and no text) → inline modules (their imports go through the map)
	const scripts: { t: FoundTag; attrs: string; url: URL }[] = [];
	for (const t of all_tags(html, 'script')) {
		const src = t.attr('src');
		if (!src || t.attr('type')?.toLowerCase() !== 'module') continue;
		if (html.slice(t.end, t.end + SCRIPT_CLOSE.length).toLowerCase() !== SCRIPT_CLOSE) continue;
		// (its other attributes as written: the tag's text without its `type` and `src`)
		const cut = [attr_span(html, t, 'script', 'type')!, attr_span(html, t, 'script', 'src')!];
		cut.sort((a, b) => a[0] - b[0]);
		const attrs = `${html.slice(t.start + 7, cut[0][0])} ${html.slice(cut[0][1], cut[1][0])} ${html.slice(cut[1][1], t.end - 1)}`;
		scripts.push({ t, attrs: attrs.replace(WS_G, ' ').trim(), url: new URL(src, base) });
	}
	const inlined: Splice[] = [];
	for (const s of scripts) {
		const key = await add_chunk(s.url);
		const code = chunks.get(key) ?? '';
		inlined.push({
			at: s.t.start,
			end: s.t.end + SCRIPT_CLOSE.length,
			text: `<script type="module" ${s.attrs} data-standalone="${s.url.pathname}">${code.replaceAll('</script', '<\\/script')}</script>`
		});
		chunks.delete(key); // inlined, not in the map
	}
	html = apply(html, inlined);
	// 4. island files → og: keys. The file is the region's `src` (its content-hashed location; the
	// `entry` is a name, no file); `entry` and `src` both name its key, so the runtime finds it by
	// either. A region with no `src` (a dev page) names its file by `entry`.
	const entries: URL[] = [];
	const keyed: Splice[] = [];
	for (const t of all_tags(html, 'ogygia-region')) {
		const src = t.attr('src') || undefined;
		const entry = t.attr('entry') || undefined;
		const file = src ?? entry;
		if (!file) continue;
		const u = new URL(file, base);
		entries.push(u);
		const key = key_of(u);
		for (const [attr, value] of [
			['entry', entry],
			['src', src]
		] as const) {
			const at = value === undefined ? -1 : value_at(html, t, 'ogygia-region', attr);
			if (at !== -1) keyed.push({ at, end: at + value!.length, text: key });
		}
	}
	keyed.sort((a, b) => a.at - b.at);
	html = apply(html, keyed);
	for (const u of entries) await add_chunk(u);

	// 5. the import map: every chunk as a data: URL, before the first module script
	const imports: Record<string, string> = {};
	for (const [key, code] of chunks) {
		if (!code) continue;
		imports[key] = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
	}
	const map = `<script type="importmap">${JSON.stringify({ imports }).replaceAll('</script', '<\\/script')}</script>`;
	const note = `<!-- ogygia profiler · standalone report · ${Object.keys(imports).length} chunks inlined${missing.length ? ` · missing: ${missing.join(', ')}` : ''} -->`;
	const first = next_tag(html, 'script', 0);
	html =
		first === null
			? before_head_end(html, map)
			: html.slice(0, first.start) + map + html.slice(first.start);
	return before_head_end(html, `<meta name="ogygia-standalone" content="1">${note}`);
}
