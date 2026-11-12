// The page markup's vocabulary (src/wire-markup.ts, #479): every `data-og*` marker the packages
// write is declared once in `MARK`, and `tags()` reads tags the way a browser does, quotes and all.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { describe, expect, it } from 'vitest';
import {
	is_marker,
	MARK,
	next_tag,
	tags,
	text_of,
	unknown_markers,
	value_at
} from '../src/wire-markup.ts';
import * as vocabulary from '../src/wire-markup.ts';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

type Ast = {
	type: string;
	name?: string;
	value?: unknown;
	[key: string]: unknown;
};
const id = (n: unknown): string | undefined => {
	const node = n as Ast;
	return node.type === 'Identifier'
		? node.name
		: typeof node.value === 'string'
			? node.value
			: undefined;
};
const literal = (n: unknown): unknown =>
	(n as Ast | null)?.type === 'Literal' ? (n as Ast).value : undefined;

/** The value `file` (a built module) exports as `name`: a constant it declares with a literal, or
 *  one it takes from a relative module, followed there. Undefined when it exports no such constant. */
function exported_constant(file: string, name: string): unknown {
	const body = parseAst(readFileSync(file, 'utf8')).body as unknown as Ast[];
	let local: string | undefined;
	for (const s of body) {
		if (s.type !== 'ExportNamedDeclaration') continue;
		const declaration = s.declaration as Ast | null;
		if (declaration?.type === 'VariableDeclaration')
			for (const d of declaration.declarations as Ast[])
				if (id(d.id) === name) return literal(d.init);
		for (const sp of s.specifiers as Ast[]) {
			if (id(sp.exported) !== name) continue;
			const from = (s.source as Ast | null)?.value;
			if (typeof from === 'string')
				return exported_constant(path.resolve(path.dirname(file), from), id(sp.local)!);
			local = id(sp.local);
		}
	}
	if (local === undefined) return undefined;
	for (const s of body) {
		if (s.type === 'VariableDeclaration')
			for (const d of s.declarations as Ast[]) if (id(d.id) === local) return literal(d.init);
		if (s.type === 'ImportDeclaration')
			for (const sp of s.specifiers as Ast[])
				if (sp.type === 'ImportSpecifier' && id(sp.local) === local)
					return exported_constant(
						path.resolve(path.dirname(file), (s.source as Ast).value as string),
						id(sp.imported)!
					);
	}
	return undefined;
}

/** Every `data-og*` name spelled in a package's source. */
function spelled(): Map<string, string> {
	const out = new Map<string, string>();
	const walk = (dir: string): void => {
		for (const e of readdirSync(dir)) {
			const p = path.join(dir, e);
			if (e === 'node_modules' || e === 'dist') continue;
			if (statSync(p).isDirectory()) walk(p);
			// (.svelte, .css and .html cannot import the constants: they spell markers, held to MARK here)
			else if (/\.(ts|svelte|js|css|html)$/.test(e) && !e.endsWith('.d.ts'))
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

	// A constant shared across chunks is not inlined by the app's bundler: an import of one from a
	// boot module pulled the whole tag reader into the boot (@ogygia/config/tsdown inline_markup_names).
	it('ships no marker constant as an import: the built files carry the literals', () => {
		const constants = new Set(
			Object.entries(vocabulary)
				.filter(([, v]) => typeof v === 'string' && v.startsWith('data-og'))
				.map(([k]) => k)
		);
		const imported: string[] = [];
		const walk = (dir: string): void => {
			for (const e of readdirSync(dir)) {
				const p = path.join(dir, e);
				if (statSync(p).isDirectory()) walk(p);
				else if (e.endsWith('.js'))
					for (const m of readFileSync(p, 'utf8').matchAll(
						/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g
					))
						for (const s of m[1].split(','))
							if (constants.has(s.trim().split(/\s+as\s+/)[0]))
								imported.push(`${s.trim()} (${path.relative(DIST, p)})`);
			}
		};
		walk(DIST);
		expect(constants.size).toBeGreaterThan(100);
		expect(imported).toEqual([]);
	});

	it('an entry that re-exports a marker constant exports its value (the compiler loads contract/)', () => {
		// (read from the built text, not imported: the server entry's graph is the whole server, and
		// loading it took over 5 s on a busy runner)
		const entries = ['contract/index.js', 'internal-server.js', 'internal-instruments.js'];
		const values: Record<string, unknown> = {};
		for (const e of entries) values[e] = exported_constant(path.join(DIST, e), 'OG_HTML');
		expect(values).toEqual(Object.fromEntries(entries.map((e) => [e, 'data-og-html'])));
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

	const names = (html: string, name: string) =>
		[...tags(html, name)].map((t) => html.slice(t.start, t.end));

	it('finds no tag in the text of a script, style, textarea, title or other raw-text element', () => {
		for (const raw of ['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'iframe']) {
			const html = `<${raw.toUpperCase()} a="1"><meta name="in"></${raw}x></${raw} ><meta name="out">`;
			expect(names(html, 'meta'), raw).toEqual(['<meta name="out">']);
		}
		expect(names('<script>"<script>"</script><script>', 'script')).toEqual([
			'<script>',
			'<script>'
		]);
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

	it('next_tag goes on from a raw-text element’s next, past its text', () => {
		const html = '<script>"<script>"</script><meta a><script></script>';
		const first = next_tag(html, 'script', 0)!;
		expect(first.next).toBe(html.indexOf('</script>'));
		expect(next_tag(html, 'script', first.next)!.start).toBe(html.lastIndexOf('<script>'));
	});

	it('value_at: where a value starts, quoted or not; -1 when absent or bare', () => {
		const html = `<meta A="x>1" b = 'two' c=three d>`;
		const t = [...tags(html, 'meta')][0];
		const at = (n: string) => value_at(html, t, 'meta', n);
		for (const n of ['a', 'b', 'c'])
			expect(html.slice(at(n), at(n) + t.attr(n)!.length)).toBe(t.attr(n));
		expect(html[at('b') - 1]).toBe("'");
		expect(at('d')).toBe(-1);
		expect(at('e')).toBe(-1);
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

	it('reads a script’s text past an escaped </script>, and a template’s up to its end tag', () => {
		const html = '<script><!--<script></script>--></script>';
		expect(text_of(html, tags(html, 'script').next().value!, 'script')).toBe(
			'<!--<script></script>-->'
		);
		const t = '<template><!-- </template> --><p>x</p></template>';
		expect(text_of(t, tags(t, 'template').next().value!, 'template')).toBe(
			'<!-- </template> --><p>x</p>'
		);
	});
});
describe('unknown_markers', () => {
	it('names a data-og* attribute no MARK entry declares, and passes the declared ones', () => {
		expect(unknown_markers(['data-og-fp', 'data-ogygia-keep', 'class', 'data-og-typo'])).toEqual([
			'data-og-typo'
		]);
	});
});
