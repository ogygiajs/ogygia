import { describe, expect, it } from 'vitest';
import { parse_yaml, parseFrontmatter } from '../src/markdown/frontmatter.ts';
import { ogygiaPreprocess } from '../src/markdown/index.ts';
import { dedent } from '@ogygia/core/plugin/utils';

describe('parse_yaml — empty & trivial', () => {
	it('empty string → {}', () => {
		expect(parse_yaml('')).toEqual({});
	});

	it('whitespace-only → {} (not null)', () => {
		expect(parse_yaml('   \n\t \n')).toEqual({});
		expect(parse_yaml('  \n  ')).not.toBeNull();
	});

	it('comment-only → {}', () => {
		expect(parse_yaml('# just a comment\n# another')).toEqual({});
	});
});

describe('parse_yaml — flat mappings & scalar types', () => {
	it('plain string values', () => {
		expect(parse_yaml('title: Hello World')).toEqual({ title: 'Hello World' });
	});

	it('integers, negatives, plus, exponents, floats', () => {
		expect(parse_yaml('a: 42')).toEqual({ a: 42 });
		expect(parse_yaml('a: -7')).toEqual({ a: -7 });
		expect(parse_yaml('a: +5')).toEqual({ a: 5 });
		expect(parse_yaml('a: 3.14')).toEqual({ a: 3.14 });
		expect(parse_yaml('a: -0.5')).toEqual({ a: -0.5 });
		expect(parse_yaml('a: .5')).toEqual({ a: 0.5 });
		expect(parse_yaml('a: 1e3')).toEqual({ a: 1000 });
		expect(parse_yaml('a: 1.5e-2')).toEqual({ a: 0.015 });
	});

	it('booleans are ONLY true/false', () => {
		expect(parse_yaml('a: true')).toEqual({ a: true });
		expect(parse_yaml('a: false')).toEqual({ a: false });
		expect(parse_yaml('a: True')).toEqual({ a: true });
		expect(parse_yaml('a: FALSE')).toEqual({ a: false });
	});

	it('Norway problem: yes/no/on/off/y/n stay STRINGS', () => {
		expect(parse_yaml('country: no')).toEqual({ country: 'no' });
		expect(parse_yaml('a: yes')).toEqual({ a: 'yes' });
		expect(parse_yaml('a: on')).toEqual({ a: 'on' });
		expect(parse_yaml('a: off')).toEqual({ a: 'off' });
		expect(parse_yaml('a: y')).toEqual({ a: 'y' });
		expect(parse_yaml('a: n')).toEqual({ a: 'n' });
		// explicit NOT boolean assertions
		expect(parse_yaml('a: no')).not.toEqual({ a: false });
		expect(typeof (parse_yaml('a: yes') as { a: unknown }).a).toBe('string');
	});

	it('null spellings: null, ~, and empty value', () => {
		expect(parse_yaml('a: null')).toEqual({ a: null });
		expect(parse_yaml('a: ~')).toEqual({ a: null });
		expect(parse_yaml('a:')).toEqual({ a: null });
		expect(parse_yaml('a: ')).toEqual({ a: null });
	});

	it('multiple keys in one block', () => {
		const out = parse_yaml(dedent`
			title: Post
			draft: false
			views: 10
		`);
		expect(out).toEqual({ title: 'Post', draft: false, views: 10 });
	});
});

describe('parse_yaml — quoting', () => {
	it("single-quoted is literal; `''` escapes a quote", () => {
		expect(parse_yaml("a: 'it''s here'")).toEqual({ a: "it's here" });
		expect(parse_yaml("a: '123'")).toEqual({ a: '123' });
	});

	it('double-quoted escapes: \\n \\t \\" \\\\ \\r \\0 \\uXXXX', () => {
		expect(parse_yaml('a: "line1\\nline2"')).toEqual({ a: 'line1\nline2' });
		expect(parse_yaml('a: "tab\\there"')).toEqual({ a: 'tab\there' });
		expect(parse_yaml('a: "quote\\"in"')).toEqual({ a: 'quote"in' });
		expect(parse_yaml('a: "back\\\\slash"')).toEqual({ a: 'back\\slash' });
		expect(parse_yaml('a: "u\\u0041"')).toEqual({ a: 'uA' });
	});

	it('numbers-that-look-like-versions stay strings if quoted', () => {
		expect(parse_yaml('version: "1.0"')).toEqual({ version: '1.0' });
		expect(parse_yaml("version: '2.0'")).toEqual({ version: '2.0' });
		// unquoted 1.2.3 is not a number → stays a string too
		expect(parse_yaml('version: 1.2.3')).toEqual({ version: '1.2.3' });
	});

	it('quoted values containing : and [ ', () => {
		expect(parse_yaml('a: "key: value"')).toEqual({ a: 'key: value' });
		expect(parse_yaml('a: "arr[0]"')).toEqual({ a: 'arr[0]' });
		expect(parse_yaml('title: "a: b"')).toEqual({ title: 'a: b' });
	});

	it('quoted KEYS (single and double), including a colon in the key', () => {
		expect(parse_yaml('"foo:bar": 1')).toEqual({ 'foo:bar': 1 });
		expect(parse_yaml("'a b': hi")).toEqual({ 'a b': 'hi' });
	});
});

describe('parse_yaml — comments', () => {
	it('trailing # comment stripped', () => {
		expect(parse_yaml('a: 1 # the number one')).toEqual({ a: 1 });
		expect(parse_yaml('a: hello   # note')).toEqual({ a: 'hello' });
	});

	it('# inside a double-quoted value is NOT a comment', () => {
		expect(parse_yaml('url: "http://x.com#frag"')).toEqual({ url: 'http://x.com#frag' });
		expect(parse_yaml('a: "hello # world"')).toEqual({ a: 'hello # world' });
	});

	it('a#b (no leading space) stays a plain scalar', () => {
		expect(parse_yaml('a: foo#bar')).toEqual({ a: 'foo#bar' });
	});

	it('value that is only a comment → null', () => {
		expect(parse_yaml('a: # nothing here')).toEqual({ a: null });
	});
});

describe('parse_yaml — nested block mappings', () => {
	it('two-level nesting', () => {
		const src = dedent`
			author:
			  name: Ada
			  age: 36
		`;
		expect(parse_yaml(src)).toEqual({ author: { name: 'Ada', age: 36 } });
	});

	it('three-level nesting', () => {
		const src = dedent`
			a:
			  b:
			    c: 1
			    d: two
		`;
		expect(parse_yaml(src)).toEqual({ a: { b: { c: 1, d: 'two' } } });
	});
});

describe('parse_yaml — block sequences', () => {
	it('simple scalar sequence', () => {
		expect(
			parse_yaml(dedent`
			tags:
			  - a
			  - b
			  - c
		`)
		).toEqual({ tags: ['a', 'b', 'c'] });
	});

	it('sequence at the SAME indent as its key', () => {
		expect(
			parse_yaml(dedent`
			tags:
			- x
			- y
		`)
		).toEqual({ tags: ['x', 'y'] });
	});

	it('typed items in a sequence', () => {
		expect(
			parse_yaml(dedent`
			nums:
			  - 1
			  - 2
			  - 3
		`)
		).toEqual({ nums: [1, 2, 3] });
	});

	it('sequence of maps', () => {
		const src = dedent`
			people:
			  - name: a
			    age: 1
			  - name: b
			    age: 2
		`;
		expect(parse_yaml(src)).toEqual({
			people: [
				{ name: 'a', age: 1 },
				{ name: 'b', age: 2 }
			]
		});
	});

	it('nested sequences (- - x)', () => {
		const src = dedent`
			grid:
			  - - 1
			    - 2
			  - - 3
			    - 4
		`;
		expect(parse_yaml(src)).toEqual({
			grid: [
				[1, 2],
				[3, 4]
			]
		});
	});

	it('empty sequence item → null', () => {
		expect(
			parse_yaml(dedent`
			a:
			  -
			  - x
		`)
		).toEqual({ a: [null, 'x'] });
	});

	it('top-level sequence', () => {
		expect(parse_yaml('- one\n- two')).toEqual(['one', 'two']);
	});
});

describe('parse_yaml — flow collections', () => {
	it('flow sequence', () => {
		expect(parse_yaml('tags: [a, b, c]')).toEqual({ tags: ['a', 'b', 'c'] });
	});

	it('flow sequence with typed values', () => {
		expect(parse_yaml('a: [1, 2.5, true, null]')).toEqual({ a: [1, 2.5, true, null] });
	});

	it('flow mapping', () => {
		expect(parse_yaml('a: { x: 1, y: two }')).toEqual({ a: { x: 1, y: 'two' } });
	});

	it('nested flow collections', () => {
		expect(parse_yaml('a: [[1, 2], [3, 4]]')).toEqual({
			a: [
				[1, 2],
				[3, 4]
			]
		});
		expect(parse_yaml('a: { b: [1, { c: 2 }] }')).toEqual({ a: { b: [1, { c: 2 }] } });
	});

	it('empty flow collections', () => {
		expect(parse_yaml('a: []')).toEqual({ a: [] });
		expect(parse_yaml('a: {}')).toEqual({ a: {} });
	});

	it('quoted string inside flow keeps commas/colons', () => {
		expect(parse_yaml('a: ["x, y", "p:q"]')).toEqual({ a: ['x, y', 'p:q'] });
	});

	it('a brace-wrapped token with no top-level colon is a STRING, not a mapping', () => {
		// Svelte docs title pages with tags — these must survive as plain strings.
		expect(parse_yaml('title: {@const}')).toEqual({ title: '{@const}' });
		expect(parse_yaml('title: {#each ...}')).toEqual({ title: '{#each ...}' });
		expect(parse_yaml('title: {let/const ...}')).toEqual({ title: '{let/const ...}' });
		// a real flow mapping (has a top-level colon) still parses as an object
		expect(parse_yaml('a: { x: 1 }')).toEqual({ a: { x: 1 } });
		// empty braces are still an empty mapping
		expect(parse_yaml('a: {}')).toEqual({ a: {} });
	});

	it('top-level flow', () => {
		expect(parse_yaml('[1, 2, 3]')).toEqual([1, 2, 3]);
	});
});

describe('parse_yaml — block scalars', () => {
	it('literal | keeps newlines', () => {
		const src = dedent`
			body: |
			  line1
			  line2
		`;
		expect(parse_yaml(src)).toEqual({
			body: `${dedent`
			line1
			line2
		`}\n`
		});
	});

	it('folded > joins lines with spaces', () => {
		const src = dedent`
			body: >
			  line1
			  line2
		`;
		expect(parse_yaml(src)).toEqual({ body: 'line1 line2\n' });
	});

	it('literal strip |- has no trailing newline', () => {
		const src = dedent`
			body: |-
			  a
			  b
		`;
		expect(parse_yaml(src)).toEqual({ body: 'a\nb' });
	});

	it('folded blank line becomes a paragraph break', () => {
		const src = dedent`
			body: >
			  a

			  b
		`;
		expect(parse_yaml(src)).toEqual({
			body: `${dedent`
			a
			b
		`}\n`
		});
	});

	it('block scalar followed by another key', () => {
		const src = dedent`
			body: |
			  hi
			  there
			title: T
		`;
		expect(parse_yaml(src)).toEqual({
			body: `${dedent`
			hi
			there
		`}\n`,
			title: 'T'
		});
	});
});

describe('parse_yaml — dates stay strings', () => {
	it('ISO date is NOT converted to a Date', () => {
		const out = parse_yaml('date: 2021-05-04') as { date: unknown };
		expect(out.date).toBe('2021-05-04');
		expect(out.date instanceof Date).toBe(false);
	});

	it('ISO datetime stays a string', () => {
		const out = parse_yaml('at: 2021-05-04T10:00:00Z') as { at: unknown };
		expect(typeof out.at).toBe('string');
	});
});

describe('parse_yaml — adversarial mixes', () => {
	it('maps and sequences deeply mixed', () => {
		const src = dedent`
			title: My Post
			draft: false
			author:
			  name: Ada
			  links:
			    - https://a.example
			    - https://b.example
			tags: [js, "ya:ml", yes]
			meta:
			  - key: k1
			    vals: [1, 2]
			  - key: k2
			    vals: []
		`;
		expect(parse_yaml(src)).toEqual({
			title: 'My Post',
			draft: false,
			author: {
				name: 'Ada',
				links: ['https://a.example', 'https://b.example']
			},
			tags: ['js', 'ya:ml', 'yes'],
			meta: [
				{ key: 'k1', vals: [1, 2] },
				{ key: 'k2', vals: [] }
			]
		});
	});

	it('CRLF line endings are handled', () => {
		expect(parse_yaml('a: 1\r\nb: 2\r\n')).toEqual({ a: 1, b: 2 });
	});

	it('blank lines between entries are ignored', () => {
		expect(
			parse_yaml(dedent`
			a: 1


			b: 2
		`)
		).toEqual({ a: 1, b: 2 });
	});

	it('trailing whitespace on lines is tolerated', () => {
		expect(parse_yaml('a: 1   \nb: hi  ')).toEqual({ a: 1, b: 'hi' });
	});

	it('a colon inside a double-quoted value does not split the key', () => {
		expect(parse_yaml('ratio: "16:9"')).toEqual({ ratio: '16:9' });
	});

	it('top-level plain scalar', () => {
		expect(parse_yaml('just a string')).toBe('just a string');
	});

	it('tabs used for indentation are rejected', () => {
		expect(() => parse_yaml('a:\n\tb: 1')).toThrow(/tabs are not allowed for indentation/);
	});
});

describe('parse_yaml — the rest of the supported subset', () => {
	it('nests at any consistent indent width (four spaces)', () => {
		expect(
			parse_yaml(dedent`
			a:
			    b:
			        c: 1
			    d: 2
		`)
		).toEqual({ a: { b: { c: 1 }, d: 2 } });
	});

	it('double-quoted escapes: \\r \\0 \\b \\f \\/', () => {
		expect(parse_yaml('a: "x\\ry"')).toEqual({ a: 'x\ry' });
		expect(parse_yaml('a: "x\\0y"')).toEqual({ a: 'x\0y' });
		expect(parse_yaml('a: "x\\by"')).toEqual({ a: 'x\by' });
		expect(parse_yaml('a: "x\\fy"')).toEqual({ a: 'x\fy' });
		expect(parse_yaml('a: "x\\/y"')).toEqual({ a: 'x/y' });
	});

	it('typed plain scalars: .inf, .nan, hex 0x, octal 0o, null casings', () => {
		expect(parse_yaml('a: .inf')).toEqual({ a: Infinity });
		expect(parse_yaml('a: -.Inf')).toEqual({ a: -Infinity });
		expect(Number.isNaN((parse_yaml('a: .nan') as { a: number }).a)).toBe(true);
		expect(parse_yaml('a: 0x1F')).toEqual({ a: 31 });
		expect(parse_yaml('a: -0x10')).toEqual({ a: -16 });
		expect(parse_yaml('a: 0o17')).toEqual({ a: 15 });
		expect(parse_yaml('a: -0o17')).toEqual({ a: -15 });
		expect(parse_yaml('a: Null')).toEqual({ a: null });
		expect(parse_yaml('a: NULL')).toEqual({ a: null });
	});

	it('# inside a single-quoted value or a flow collection is NOT a comment', () => {
		expect(parse_yaml("a: 'x # y'")).toEqual({ a: 'x # y' });
		expect(parse_yaml('a: [x #y, z]')).toEqual({ a: ['x #y', 'z'] });
	});

	it('a colon inside a single-quoted key does not split it', () => {
		expect(parse_yaml("'a: b': 1")).toEqual({ 'a: b': 1 });
	});

	it('chomping: |+ keeps the trailing blank lines, >- strips the last newline', () => {
		expect(
			parse_yaml(dedent`
			a: |+
			  x

			b: 1
		`)
		).toEqual({ a: 'x\n\n', b: 1 });
		expect(
			parse_yaml(dedent`
			a: >-
			  x
			  y
		`)
		).toEqual({ a: 'x y' });
	});

	it('an explicit indent indicator (|1) keeps the spaces past it', () => {
		expect(
			parse_yaml(dedent`
			a: |1
			   x
			   y
		`)
		).toEqual({ a: '  x\n  y\n' });
	});

	it('anchors, aliases, tags and merge keys stay plain text', () => {
		expect(
			parse_yaml(dedent`
			a: &x 1
			b: *x
			c: !!str 5
			<<: *x
		`)
		).toEqual({
			a: '&x 1',
			b: '*x',
			c: '!!str 5',
			'<<': '*x'
		});
	});

	it('a second document after an inner --- is not read', () => {
		expect(
			parse_yaml(dedent`
			a: 1
			---
			b: 2
		`)
		).toEqual({ a: 1 });
	});

	it('an empty key is rejected with its line', () => {
		expect(() => parse_yaml(': value')).toThrow(/empty mapping key in line: ": value"/);
	});

	it('a byte order mark before the first line is dropped', () => {
		expect(parse_yaml('\uFEFFa: 1')).toEqual({ a: 1 });
		expect(parse_yaml('\uFEFF- a\n- b')).toEqual(['a', 'b']);
	});

	it('only a top-level : makes a flow mapping (a nested one stays text)', () => {
		expect(parse_yaml('title: {#each items as { id: x }}')).toEqual({
			title: '{#each items as { id: x }}'
		});
	});
});

describe('parseFrontmatter', () => {
	it('no opening fence: no data, the whole text is the body', () => {
		expect(parseFrontmatter('# Hi\n')).toEqual({ data: {}, body: '# Hi\n' });
		// a rule (`---`) later in the text is not a fence
		expect(
			parseFrontmatter(dedent`
			Hi
			---
			body
		`)
		).toEqual({
			data: {},
			body: dedent`
			Hi
			---
			body
		`
		});
	});

	it('no closing fence: no data, the whole text is the body', () => {
		expect(
			parseFrontmatter(
				`${dedent`
			---
			title: x
			# Hi
		`}\n`
			)
		).toEqual({
			data: {},
			body: `${dedent`
				---
				title: x
				# Hi
			`}\n`
		});
	});

	it('a byte order mark before the fence is dropped', () => {
		expect(
			parseFrontmatter(
				String.fromCharCode(0xfeff) +
					dedent`
						---
						title: x
						---
						body
					`
			)
		).toEqual({
			data: { title: 'x' },
			body: 'body'
		});
	});

	it('frontmatter that is a list or a scalar gives no data', () => {
		expect(
			parseFrontmatter(dedent`
			---
			- a
			- b
			---
			body
		`).data
		).toEqual({});
		expect(
			parseFrontmatter(dedent`
			---
			just text
			---
			body
		`).data
		).toEqual({});
	});

	it('a parse failure is reported as invalid frontmatter, with the reason', () => {
		expect(() =>
			parseFrontmatter(
				`${dedent`
			---
			a:
				b: 1
			---
		`}\n`
			)
		).toThrow(/invalid frontmatter YAML: .*tabs are not allowed for indentation/);
	});
});

describe('the markdown preprocessor reads frontmatter with parse_yaml, not js-yaml', () => {
	const metadata = async (src: string): Promise<Record<string, unknown>> => {
		const out = await ogygiaPreprocess().markup?.({ content: src, filename: '/x/fm.md' });
		const m = /export const metadata = (\{.*?\});/s.exec((out as { code: string }).code);
		if (!m) throw new Error('no metadata export found');
		return JSON.parse(m[1]!);
	};

	it('no stays a string and {@const} stays the title', async () => {
		const meta = await metadata(
			`${dedent`
			---
			country: no
			title: {@const}
			---

			Hi
		`}\n`
		);
		expect(meta.country).toBe('no');
		expect(meta.title).toBe('{@const}');
	});

	it('frontmatter that is a list gives no fields', async () => {
		const none = await metadata('Hi\n');
		expect(
			await metadata(
				`${dedent`
			---
			- a
			- b
			---

			Hi
		`}\n`
			)
		).toEqual(none);
	});
});

describe('parse_yaml — a `__proto__` key is a plain key', () => {
	for (const [form, source] of [
		['block map', '__proto__:\n  polluted: true'],
		['flow map', 'x: { __proto__: { polluted: true } }'],
		['quoted key', '"__proto__":\n  polluted: true']
	] as const) {
		it(`${form}: it is the object's own key, never its prototype`, () => {
			const out = parse_yaml(source) as Record<string, unknown>;
			const obj = (form === 'flow map' ? out.x : out) as Record<string, unknown>;
			expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
			expect(obj.polluted).toBeUndefined();
			expect(Object.hasOwn(obj, '__proto__')).toBe(true);
			expect(Object.getOwnPropertyDescriptor(obj, '__proto__')?.value).toEqual({ polluted: true });
		});
	}
});
