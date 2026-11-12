// The page markup's vocabulary (src/wire-markup.ts, #479): every `data-og*` marker the packages
// write is declared once in `MARK`, and `tags()` reads tags the way a browser does, quotes and all.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { is_marker, MARK, tags, unknown_markers } from '../src/wire-markup.ts';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

/** Every `data-og*` name spelled in a package's source. */
function spelled(): Map<string, string> {
	const out = new Map<string, string>();
	const walk = (dir: string): void => {
		for (const e of readdirSync(dir)) {
			const p = path.join(dir, e);
			if (e === 'node_modules' || e === 'dist') continue;
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(ts|svelte|js)$/.test(e) && !e.endsWith('.d.ts'))
				for (const m of readFileSync(p, 'utf8').matchAll(/data-og(?:ygia)?-[a-z0-9-]*[a-z0-9]/g))
					if (!out.has(m[0])) out.set(m[0], path.relative(PACKAGES, p));
		}
	};
	for (const pkg of readdirSync(PACKAGES)) {
		const src = path.join(PACKAGES, pkg, 'src');
		try {
			if (statSync(src).isDirectory()) walk(src);
		} catch {
			// ok: a package with no src has nothing spelled
		}
	}
	return out;
}

describe('MARK', () => {
	it('declares every data-og* marker a package spells', () => {
		const missing = [...spelled()]
			.filter(([name]) => !is_marker(name))
			.map(([name, file]) => `${name} (${file})`);
		expect(missing).toEqual([]);
	});

	it('spells each marker once', () => {
		const attrs = Object.values(MARK).map((m) => m.attr);
		expect(new Set(attrs).size).toBe(attrs.length);
	});
});

describe('tags', () => {
	it('reads a tag as a browser does: quoted values may hold > and the other quote', () => {
		const html = `<link rel="stylesheet" data-ogygia-region-css="a>b" href='/x.css?q="1"'><p>x</p><link data-ogygia-keep href=/y.css>`;
		const found = [...tags(html, 'link')];
		expect(found.map((t) => Object.fromEntries(t.attrs))).toEqual([
			{ rel: 'stylesheet', 'data-ogygia-region-css': 'a>b', href: '/x.css?q="1"' },
			{ 'data-ogygia-keep': '', href: '/y.css' }
		]);
		expect(html.slice(found[0].start, found[0].end)).toBe(
			'<link rel="stylesheet" data-ogygia-region-css="a>b" href=\'/x.css?q="1"\'>'
		);
	});

	it('skips comments, and a name that only starts the same', () => {
		const html = '<!-- <link data-og-fp="x"> --><linker a="1"><LINK B="2">';
		expect([...tags(html, 'link')].map((t) => Object.fromEntries(t.attrs))).toEqual([{ b: '2' }]);
	});

	const names = (html: string, name: string) =>
		[...tags(html, name)].map((t) => html.slice(t.start, t.end));

	it('finds no tag in the text of a script, style, textarea, title or other raw-text element', () => {
		for (const raw of ['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'iframe']) {
			const html = `<${raw.toUpperCase()} a="1"><meta name="in"></${raw}x></${raw} ><meta name="out">`;
			expect(names(html, 'meta'), raw).toEqual(['<meta name="out">']);
		}
		expect(names('<script>"<meta>"</script>', 'script')).toEqual(['<script>']);
	});

	it('finds no tag in a bogus comment, a processing instruction or CDATA', () => {
		expect(names('<?x <meta name="in">?><meta name="out">', 'meta')).toEqual(['<meta name="out">']);
		expect(names('<!x <meta name="in">--><meta name="out">', 'meta')).toEqual([
			'<meta name="out">'
		]);
		expect(names('<![CDATA[<meta name="in">]]><meta name="out">', 'meta')).toEqual([
			'<meta name="out">'
		]);
		expect(names('</ <meta name="in">><meta name="out">', 'meta')).toEqual(['<meta name="out">']);
	});

	it('ends a comment where the browser does: <!-->, <!---> and --!> end it', () => {
		expect(names('<!--><meta name="a"><!---><meta name="b">', 'meta')).toEqual([
			'<meta name="a">',
			'<meta name="b">'
		]);
		expect(names('<!-- x --!><meta name="c">', 'meta')).toEqual(['<meta name="c">']);
	});

	it('reads a script’s escaped text as the browser does: <!-- <script> runs past one </script>', () => {
		expect(names('<script><!--<script></script><meta a></script><meta b>', 'meta')).toEqual([
			'<meta b>'
		]);
		expect(names('<script><!--<script>--><meta a></script><meta b>', 'meta')).toEqual(['<meta b>']);
		expect(names('<script><!--></script><meta b>', 'meta')).toEqual(['<meta b>']);
	});

	it('finds no tag inside a quoted attribute value of an end tag', () => {
		expect(names('</div title="<meta name=in>"><meta name="out">', 'meta')).toEqual([
			'<meta name="out">'
		]);
	});
});

describe('unknown_markers', () => {
	it('names a data-og* attribute no MARK entry declares, and passes the declared ones', () => {
		expect(unknown_markers(['data-og-fp', 'data-ogygia-keep', 'class', 'data-og-typo'])).toEqual([
			'data-og-typo'
		]);
	});
});
