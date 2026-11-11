// The page markup's vocabulary (src/wire-markup.ts, #479): every `data-og*` marker the packages
// write is declared once in `MARK`, and `tags()` reads tags the way a browser does, quotes and all.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { is_marker, MARK, tags, text_of, unknown_markers } from '../src/wire-markup.ts';

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
		const html =
			'<link rel="stylesheet" data-ogygia-region-css="a>b" href=\'/x.css?q="1"\'><p>x</p>' +
			'<link data-ogygia-keep href=/y.css>';
		const found = [...tags(html, 'link')];
		expect(found.map((t) => Object.fromEntries(t.attrs))).toEqual([
			{ rel: 'stylesheet', 'data-ogygia-region-css': 'a>b', href: '/x.css?q="1"' },
			{ 'data-ogygia-keep': '', href: '/y.css' }
		]);
		expect(html.slice(found[0].start, found[0].end)).toBe(
			'<link rel="stylesheet" data-ogygia-region-css="a>b" href=\'/x.css?q="1"\'>'
		);
	});

	it('drops a tag the HTML ends inside, and an unclosed quoted value ends the scan', () => {
		expect([...tags('<a x="1"><a y', 'a')].map((t) => Object.fromEntries(t.attrs))).toEqual([
			{ x: '1' }
		]);
		expect([...tags('<a x="1><a y=2>', 'a')]).toEqual([]);
		expect([...tags('<a x=\'1"><a y="2">', 'a')]).toEqual([]);
	});

	it('starts where it is asked to', () => {
		const html = '<a n="1"><a n="2">';
		expect([...tags(html, 'a', 1)].map((t) => t.attrs.get('n'))).toEqual(['2']);
	});

	it('skips comments, and a name that only starts the same', () => {
		const html = '<!-- <link data-og-fp="x"> --><linker a="1"><LINK B="2">';
		expect([...tags(html, 'link')].map((t) => Object.fromEntries(t.attrs))).toEqual([{ b: '2' }]);
	});

	it('value_at: where a value starts, quoted or not; -1 when absent or bare', () => {
		const html = `<meta A="x>1" b = 'two' c=three d>`;
		const t = [...tags(html, 'meta')][0];
		for (const n of ['a', 'b', 'c'])
			expect(html.slice(t.value_at(n), t.value_at(n) + t.attr(n)!.length)).toBe(t.attr(n));
		expect(html[t.value_at('b') - 1]).toBe("'");
		expect(t.value_at('d')).toBe(-1);
		expect(t.value_at('e')).toBe(-1);
	});
});

describe('text_of', () => {
	it('reads raw text up to the first closing tag of that name, any case, and null when it never closes', () => {
		const html = '<script type="application/json">{"a":"<b>"}</SCRIPT ><script>x';
		const [first, second] = [...tags(html, 'script')];
		expect(text_of(html, first, 'script')).toBe('{"a":"<b>"}');
		expect(text_of(html, second, 'script')).toBe(null);
		expect(
			text_of('<script>a</scripts></script>', [...tags('<script>', 'script')][0], 'script')
		).toBe('a</scripts>');
	});
});

describe('unknown_markers', () => {
	it('names a data-og* attribute no MARK entry declares, and passes the declared ones', () => {
		expect(unknown_markers(['data-og-fp', 'data-ogygia-keep', 'class', 'data-og-typo'])).toEqual([
			'data-og-typo'
		]);
	});
});
