// The macro scanner (src/compiler/parse/scan.ts) against a real parser: `find_og_calls` finds exactly
// the `import.meta.og.<name>(…)` calls oxc finds, at the same spans, in programs built from the
// things a lexer can trip on (strings with quotes and parens, comments, regex literals in every
// position a regex can start, division, templates with interpolations). Seeded (OGYGIA_FUZZ_SEED).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { find_og_calls, match_close, split_first_string } from '../src/compiler/parse/scan.ts';
import { parse_module, type AstNode } from '../src/compiler/parse/oxc.ts';

const PREFIX = 'import.meta.og.';

/** `import.meta.og.<chain>` as a dotted name, or null. */
function og_name(callee: AstNode): string | null {
	const names: string[] = [];
	let n = callee;
	while (n?.type === 'MemberExpression' && !n.computed) {
		names.unshift(n.property.name);
		n = n.object;
	}
	if (n?.type !== 'MetaProperty' || n.meta.name !== 'import' || n.property.name !== 'meta')
		return null;
	if (names[0] !== 'og' || names.length < 2) return null;
	return names.slice(1).join('.');
}

/** The outermost og calls oxc sees (the scanner does not look inside a call's arguments). */
function oxc_calls(code: string): string[] {
	const r = parse_module(code, 'x.js');
	if (!r.ok || !r.program) throw new Error(`not a program: ${code}`);
	const out: string[] = [];
	const walk = (n: unknown): void => {
		if (Array.isArray(n)) {
			n.forEach(walk);
			return;
		}
		if (!n || typeof n !== 'object') return;
		const node = n as AstNode;
		if (node.type === 'CallExpression') {
			const name = og_name(node.callee);
			if (name !== null) return void out.push(`${node.start}-${node.end} ${name}`);
		}
		for (const k in node) if (k !== 'parent') walk(node[k]);
	};
	walk(r.program);
	return out;
}

const scanned = (code: string): string[] =>
	find_og_calls(code, PREFIX).map((c) => `${c.start}-${c.end} ${c.method}`);

/** A statement a lexer must get past without losing its place. */
const piece: fc.Arbitrary<string> = fc.oneof(
	fc.constantFrom(
		`const a = import.meta.og.wire({ encode: (v) => ')', decode: (v) => v });`,
		`const b = import.meta.og.code('./x.ts');`,
		`const c = import.meta.og.loader.git("a)b", { page: /\\)/ });`,
		`// import.meta.og.wire(1) it's a comment`,
		`/* import.meta.og.code('x') "unclosed */`,
		`const s1 = 'import.meta.og.wire(1) \\' "';`,
		`const s2 = "import.meta.og.code(') \\" '";`,
		`const r1 = /[/'"]import.meta.og.x(/g;`,
		`const r2 = x.split(/'/);`,
		`const d1 = a / b / c;`,
		`const d2 = (a) / 2 / (b);`,
		`const d3 = arr[0] / 2;`,
		`function f1(s) { return /'/.test(s); }`,
		`function f2(s) { return typeof /"/; }`,
		`if (a) /'/.test(b);`,
		`const t1 = \`a \${b} c\`;`,
		`const t2 = \`a \${import.meta.og.code('t')} c\`;`,
		`const t3 = \`a \${\`'\`} c\`;`,
		`const t4 = \`a \${ { k: '}' }.k } c\`;`,
		`const o = { a: 1, 'b)': 2 };`,
		`const sp = [...import.meta.og.code('s'), ...xs];`,
		`const ch = a?.b / 2;`,
		`const fl = .5 / 2;`,
		// a division after each kind of value, a regex after each kind of opener
		`const d4 = 'a' / 2 / "b";`,
		`const d5 = /a/gi / 2 / 1;`,
		`const d6 = \`t\` / 2 / 1;`,
		`const d7 = x.return / 2 / y.typeof;`,
		`let i = 0; const d8 = i++ / 2 / i--;`,
		`const d9 = 10 / 2 / 1e3;`,
		`{ } /'/.test(a);`,
		`while (a) /'/.test(b);`,
		`for (const x of y) /'/.test(x);`,
		`switch (a) { case /'/: break; }`,
		`const r3 = a ? /'/ : /"/;`,
		`const r4 = [/'/, /"/];`,
		`const r5 = !/'/.test(a) && /"/.test(b);`,
		`const r6 = ++/'/.lastIndex;`,
		`const q = "/'";`,
		`const ü = 4; const d10 = ü / 2 / ü;`
	),
	fc.constant(`const z = 'x';`)
);

describe('find_og_calls keeps its place (#1441)', () => {
	const CALL = `export const a = import.meta.og.regions('./b/*.svelte');\nconst z = 'x';`;
	it.each([
		['a regex holding a quote after return', `function f(s) { return /'/.test(s); }\n${CALL}`],
		['a regex after typeof', `const t = typeof /"/;\n${CALL}`],
		["a regex after an if's condition", `if (a) /'/.test(b);\n${CALL}`],
		['a nested template holding a quote', `const t = \`a \${\`'\`} b\`;\n${CALL}`],
		[
			'a postfix increment before a division',
			`let i = 0; const d = i++ / 2; const s = "'";\n${CALL}`
		],
		[
			'a postfix increment before a division, on the same line as the call',
			`let i = 0; const d = i++ / 2; const s = "'"; ${CALL}`
		],
		[
			'a division after a name that ends in a non-ASCII letter',
			`const café = 4; const x = café / 2; ${CALL}`
		],
		['a division after a non-ASCII name', `const 𝒳 = 4; const x = 𝒳 / 2; ${CALL}`],
		['a regex after a non-ASCII space', `const x = /'/.test(s);\n${CALL}`]
	])('past %s', (_, code) => {
		expect(scanned(code)).toEqual(oxc_calls(code));
		expect(scanned(code)).toHaveLength(1);
	});

	it.each([
		['return', `function f() { return /'/; }`],
		['typeof', `typeof /'/;`],
		['instanceof', `a instanceof /'/;`],
		['in', `a in /'/;`],
		['of', `for (const x of /'/);`],
		['new', `new /'/;`],
		['delete', `delete /'/;`],
		['void', `void /'/;`],
		['throw', `function f() { throw /'/; }`],
		['case', `switch (a) { case /'/: }`],
		['do', `do /'/; while (a);`],
		['else', `if (a); else /'/;`],
		['yield', `function* g() { yield /'/; }`],
		['await', `async function h() { await /'/; }`],
		['if', `if (a) /'/;`],
		['while', `while (a) /'/;`],
		['for', `for (;;) /'/;`],
		['for await', `async function h() { for await (const x of y) /'/; }`],
		['a block', `{ } /'/;`]
	])('a regex after %s, on the same line as a call', (_, code) => {
		const line = `${code} ${CALL}`;
		expect(scanned(line)).toEqual(oxc_calls(line));
		expect(scanned(line)).toHaveLength(1);
	});

	it("a regex after a with statement's condition", () => {
		expect(scanned(`with (a) /'/; ${CALL}`)).toHaveLength(1);
	});

	it("a call inside a template's interpolation is found", () => {
		const code = `const t = \`a \${import.meta.og.code('t')} c\`;`;
		expect(scanned(code)).toEqual(['15-39 code']);
		expect(scanned(code)).toEqual(oxc_calls(code));
	});

	it('a call spread into an array or a call is found', () => {
		for (const code of [
			`const all = [...import.meta.og.regions('./*.svelte')];`,
			`f(...import.meta.og.code('x'));`
		]) {
			expect(scanned(code)).toHaveLength(1);
			expect(scanned(code)).toEqual(oxc_calls(code));
		}
	});

	it('a marker inside a block comment after a value is no call', () => {
		const code = `const a = 1 /* import.meta.og.code('x') */; ${CALL}`;
		expect(scanned(code)).toEqual(oxc_calls(code));
		expect(scanned(code)).toHaveLength(1);
	});

	it('a marker as a property name is no call', () => {
		expect(scanned(`x.import.meta.og.code('t');`)).toEqual([]);
	});

	it("match_close is not cut short by a keyword's regex", () => {
		const src = `(() => { return /\\)/.test(x); })`;
		expect(match_close(src, 0)).toBe(src.length - 1);
	});
});

describe('find_og_calls finds what a parser finds', () => {
	it('in any program of these pieces', () => {
		fc.assert(
			// (on one line, a slash read the wrong way runs on into the next piece instead of stopping
			// at the line's end, so every misread hides a later call)
			fc.property(fc.array(piece, { maxLength: 6 }), fc.constantFrom('\n', ' '), (pieces, sep) => {
				const code = pieces.join(sep);
				expect(scanned(code)).toEqual(oxc_calls(code));
			})
		);
	});
});

describe('match_close', () => {
	it('the paren that closes, past strings, comments and a regex char class', () => {
		const src = `(a, ')', "(", /[)]/, // )\n /* ) */ b)`;
		expect(match_close(src, 0)).toBe(src.length - 1);
		expect(match_close('(a', 0)).toBe(-1);
	});
});

describe('split_first_string', () => {
	it('the first literal, any quote, escapes kept, and the rest', () => {
		expect(split_first_string(` 'a\\'b' , { x: 1 } `, 'f')).toEqual({
			value: "a\\'b",
			rest: '{ x: 1 }'
		});
		expect(split_first_string('"a"', 'f')).toEqual({ value: 'a', rest: '' });
		expect(split_first_string('`a`  ,b', 'f')).toEqual({ value: 'a', rest: 'b' });
	});

	it('refuses a name, an interpolation, and a literal inside an expression', () => {
		expect(() => split_first_string('dir', 'f')).toThrow(/call_arg_not_literal|literal/);
		expect(() => split_first_string('`a${b}`', 'f')).toThrow();
		expect(() => split_first_string(`'./' + dir`, 'f')).toThrow();
	});
});
