/**
 * `import.meta.og.$` — the fn-hoist construct. Transform-level tests: detection, capture
 * analysis (free names → bound params, globals pass), the __og_$ rewrite, manifest hoists,
 * and the strict-position build errors.
 */
import { describe, it, expect } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import {
	fn_manifest_entries,
	fn_manifest_registrations,
	rewrite_dollar
} from '../src/compiler/macros/dollar.ts';
import { __register_fn, fn_handle } from '../../core/src/fn-transport.ts';

const SVELTE = ['.svelte'];
const run = (src: string, id = 'src/routes/x.ts') => rewrite_dollar(src, id, id, SVELTE);

describe('og.$ transform', () => {
	it('rewrites the mark to __og_$(tag, [captures], factory) and injects the import', () => {
		const src = `const tax = 0.19;\nexport const fmt = import.meta.og.$((n) => n * (1 + tax));`;
		const { code, hoists } = run(src);
		expect(code).toContain(`import { __og_$ } from 'ogygia/internal';`);
		expect(code).toContain(`__og_$("src/routes/x.ts#$0", [tax], (tax) => ((n) => n * (1 + tax)))`);
		expect(hoists).toHaveLength(1);
		expect(hoists[0].tag).toBe('src/routes/x.ts#$0');
		expect(hoists[0].factory_src).toBe('(tax) => ((n) => n * (1 + tax))');
	});

	it('captures: locals bind; params/inner declarations/globals do not', () => {
		const src = `const a = 1; const b = 2;\nconst f = import.meta.og.$((x) => { const c = a + x; return Math.max(c, b, JSON.parse('3')); });`;
		const { hoists } = run(src);
		expect(hoists[0].factory_src.startsWith('(a, b) =>')).toBe(true); // x, c, Math, JSON excluded
	});

	it('member properties and object keys are not captures', () => {
		const src = `const obj = { deep: 1 };\nconst f = import.meta.og.$(() => ({ made: obj.deep, obj: 1 }));`;
		const { hoists } = run(src);
		expect(hoists[0].factory_src.startsWith('(obj) =>')).toBe(true); // only `obj`; `.deep`/keys excluded
	});

	it('a capture-free fn hoists with empty params', () => {
		const { code, hoists } = run(`const f = import.meta.og.$(() => 42);`);
		expect(hoists[0].factory_src).toBe('() => (() => 42)');
		expect(code).toContain(`[], () => (() => 42)`);
	});

	it('multiple marks in one module get sequential tags', () => {
		const src = `const f = import.meta.og.$(() => 1);\nconst g = import.meta.og.$(() => 2);`;
		const { hoists } = run(src);
		expect(hoists.map((h) => h.tag)).toEqual(['src/routes/x.ts#$0', 'src/routes/x.ts#$1']);
	});

	it('works inside a .svelte script block', () => {
		const src = dedent`
			<script>
				const site = 'x';
				const track = import.meta.og.$((e) => [site, e]);
			</script>
			<button onclick={() => track('hi')}>go</button>
		`;
		const { code, hoists } = rewrite_dollar(
			src,
			'src/routes/+layout.svelte',
			'src/routes/+layout.svelte',
			SVELTE
		);
		expect(hoists[0].tag).toBe('src/routes/+layout.svelte#$0');
		expect(code).toContain('__og_$(');
	});

	it('no marker → same reference back, zero hoists', () => {
		const src = `export const x = 1;`;
		const res = run(src);
		expect(res.code).toBe(src);
		expect(res.hoists).toEqual([]);
	});

	it('BUILD ERROR: zero or two arguments', () => {
		expect(() => run(`const f = import.meta.og.$();`)).toThrow(/exactly one argument/);
		expect(() => run(`const f = import.meta.og.$(() => 1, 2);`)).toThrow(/exactly one argument/);
	});

	it('a non-function argument is a BOUNDARY ASSERTION, not an error (universal mark)', () => {
		const { code } = run(`const f = import.meta.og.$(someFn);`);
		expect(code).toContain(`__og_boundary((someFn), "src/routes/x.ts:1")`);
	});

	it('BUILD ERROR: bare access / aliasing', () => {
		expect(() => run(`const alias = import.meta.og.$;`)).toThrow(/bare import.meta.og.\$/);
	});

	it('marker inside a string is never rewritten', () => {
		const src = `const s = "import.meta.og.$(() => 1)";`;
		// parses fine; the AST sees a string literal, not a call — untouched
		const res = run(src);
		expect(res.code).toBe(src);
	});
});

describe('og.$ captures: what the far side would read', () => {
	const params = (src: string) => run(src).hoists[0]!.factory_src.split(' => (')[0];

	it('a name a block shadows is still captured where the block does not reach', () => {
		expect(
			params(
				`const tax = 0.2; export const f = import.meta.og.$((n) => { if (n) { const tax = 1; } return n * tax; });`
			)
		).toBe('(tax)');
	});

	it("an inner function's parameter shadows only inside that function", () => {
		expect(
			params(`const v = 2; export const f = import.meta.og.$((xs) => xs.map((v) => v).concat(v));`)
		).toBe('(v)');
	});

	it('a global name the module binds (an import) is captured, never read as the global', () => {
		expect(
			params(`import { fetch } from './api'; export const f = import.meta.og.$(() => fetch('/x'));`)
		).toBe('(fetch)');
	});

	it('a class method name is no capture', () => {
		expect(
			params(
				`export const f = import.meta.og.$(() => new (class { greet() { return 1; } })().greet());`
			)
		).toBe('()');
	});

	it("a class static block's names stay in the block: a read after the class is captured (#1634)", () => {
		expect(
			params(
				`const tax = 0.2; export const f = import.meta.og.$(() => { class K { static { const tax = 1; } } return tax; });`
			)
		).toBe('(tax)');
	});

	it("a class expression's own name, read inside it, is no capture (#1634)", () => {
		expect(
			params(
				`const K = 1; export const f = import.meta.og.$(() => new (class K { m() { return K; } })());`
			)
		).toBe('()');
	});

	it('import.meta is no capture', () => {
		expect(params(`export const f = import.meta.og.$(() => import.meta.env.DEV);`)).toBe('()');
	});

	it('BUILD ERROR: a $() inside another $()', () => {
		expect(() =>
			run(`export const f = import.meta.og.$(() => import.meta.og.$(() => 1));`)
		).toThrow(/inside another/);
	});
});

describe('og.$ end-to-end (transform output executed against the real runtime)', () => {
	it('the rewritten expression returns a live, correctly-bound function', () => {
		const src = `const tax = 0.19;\nglobalThis.__dollar_out = import.meta.og.$((n) => Math.round(n * (1 + tax)));`;
		const { code } = run(src, 'src/lib/pricing.ts');
		// execute the transformed module body with the real runtime in scope
		const body = code.replace(`import { __og_$ } from 'ogygia/internal';`, '');
		new Function('__og_$', body)(
			(tag: string, bound: unknown[], factory: (...b: unknown[]) => unknown) => {
				__register_fn(tag, factory);
				return fn_handle(tag, bound);
			}
		);
		const live = (globalThis as Record<string, unknown>).__dollar_out as (n: number) => number;
		expect(live(100)).toBe(119);
		delete (globalThis as Record<string, unknown>).__dollar_out;
	});
});

describe('og.$ server-only capture rejection', () => {
	it('BUILD ERROR: capturing a $env/static/private import', () => {
		const src = `import { API_KEY } from '$env/static/private';\nconst f = import.meta.og.$(() => fetch('/x?k=' + API_KEY));`;
		expect(() => run(src)).toThrow(/captures `API_KEY` from the server-only module/);
	});

	it('BUILD ERROR: capturing from a .server module or $app/server', () => {
		const a = `import { db } from '$lib/db.server.js';\nconst f = import.meta.og.$(() => db);`;
		expect(() => run(a)).toThrow(/server-only module '\$lib\/db\.server\.js'/);
		const b = `import { read } from '$app/server';\nconst f = import.meta.og.$(() => read);`;
		expect(() => run(b)).toThrow(/server-only module '\$app\/server'/);
	});

	it('BUILD ERROR: capturing a $env/dynamic/private import', () => {
		const src = `import { env } from '$env/dynamic/private';\nconst f = import.meta.og.$(() => env.KEY);`;
		expect(() => run(src)).toThrow(/captures `env` from the server-only module/);
	});

	it('public env and normal imports still capture fine', () => {
		const src = `import { PUB } from '$env/static/public';\nconst f = import.meta.og.$(() => PUB);`;
		expect(run(src).hoists).toHaveLength(1);
	});
});

describe('og.$ as the UNIVERSAL boundary mark (non-function values)', () => {
	it('a non-function value rewrites to a boundary assertion at the marked site', () => {
		const src = `const store = makeStore();\nconst v = import.meta.og.$(store);`;
		const { code } = run(src);
		expect(code).toContain(`__og_boundary((store), "src/routes/x.ts:2")`);
		expect(code).toContain(`import { __og_boundary } from 'ogygia/internal';`);
	});

	it('mixed fn + value marks in one module import both runtimes', () => {
		const src = `const a = import.meta.og.$(() => 1);\nconst b = import.meta.og.$({ x: 1 });`;
		const { code } = run(src);
		expect(code).toContain(`import { __og_$, __og_boundary } from 'ogygia/internal';`);
	});
});

describe('og.$ in TEMPLATE expressions (props in markup)', () => {
	it('an inline fn prop hoists with captures from the component scope', () => {
		const src = dedent`
			<script>
				const rate = 2;
			</script>
			<Island fmt={import.meta.og.$((n) => n * rate)} />
		`;
		const { code, hoists } = rewrite_dollar(
			src,
			'src/routes/p.svelte',
			'src/routes/p.svelte',
			SVELTE
		);
		expect(code).toContain(
			`fmt={__og_$("src/routes/p.svelte#$0", [rate], (rate) => ((n) => n * rate))}`
		);
		expect(code).toContain(`import { __og_$ } from 'ogygia/internal';`);
		expect(hoists).toHaveLength(1);
	});

	it('a value prop becomes a boundary assertion; imports merge with script-pass injection', () => {
		const src = dedent`
			<script>
				const s = makeStore();
				const f = import.meta.og.$(() => 1);
			</script>
			<Island store={import.meta.og.$(s)} />
		`;
		const { code } = rewrite_dollar(src, 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE);
		expect(code).toContain(`store={__og_boundary((s), "src/routes/p.svelte:5")}`);
		expect(code).toContain(`import { __og_$, __og_boundary } from 'ogygia/internal';`);
	});

	it('a markup mark with no <script> to take its import fails the build', () => {
		const src = `<Island fmt={import.meta.og.$((n) => n)} />`;
		expect(() => rewrite_dollar(src, 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE)).toThrow(
			/needs a <script> block/
		);
	});

	it('a markup mark with no argument, or one that does not parse, fails the build', () => {
		const tpl = (prop: string) => dedent`
			<script>
				const r = 1;
			</script>
			<Island fmt={${prop}} />
		`;
		const at = (prop: string) => () =>
			rewrite_dollar(tpl(prop), 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE);
		expect(at('import.meta.og.$()')).toThrow(/exactly one argument/);
		expect(at('import.meta.og.$((n) => )')).toThrow(/does not parse/);
	});

	it('a markup mark inside another markup mark fails the build', () => {
		const src = dedent`
			<script>
				const r = 1;
			</script>
			<Island fmt={import.meta.og.$(() => import.meta.og.$(() => r))} />
		`;
		expect(() => rewrite_dollar(src, 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE)).toThrow(
			/inside another \$\(\)/
		);
	});

	it('a script mark that opens a call is rewritten once, by the script pass', () => {
		const src = dedent`
			<script>
				const r = 1;
				register(import.meta.og.$(() => r));
			</script>
			<p>x</p>
		`;
		const { hoists } = rewrite_dollar(src, 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE);
		expect(hoists.map((h) => h.tag)).toEqual(['src/routes/p.svelte#$0']);
	});

	it('markup that names the marker outside an expression, or a longer member, is left alone', () => {
		const src = dedent`
			<script>
				const r = 1;
			</script>
			<p>use import.meta.og.$(fn) in a prop</p>
			<p>{import.meta.og.$x(r)}</p>
		`;
		const { code } = rewrite_dollar(src, 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE);
		expect(code).toBe(src);
	});
});

describe('og.$ module shape', () => {
	it('the injected import keeps every line where it was', () => {
		const src = dedent`
			const a = 1;
			export const f = import.meta.og.$(() => a);
			export const g = 2;
		`;
		const { code } = run(src);
		expect(code.split('\n').length).toBe(src.split('\n').length);
		expect(code.split('\n')[1]).toContain('__og_$(');
	});

	it('a module that does not parse mid-edit is left as written', () => {
		const src = dedent`
			export const f = import.meta.og.$((n) => n);
			const x = ;
		`;
		expect(run(src)).toEqual({ code: src, hoists: [] });
	});

	it('every platform global a body reads passes through uncaptured', () => {
		const globals = [
			'undefined',
			'NaN',
			'Infinity',
			'globalThis',
			'console',
			'Math',
			'JSON',
			'Date',
			'RegExp',
			'Error',
			'TypeError',
			'RangeError',
			'Object',
			'Array',
			'String',
			'Number',
			'Boolean',
			'Symbol',
			'BigInt',
			'Map',
			'Set',
			'WeakMap',
			'WeakSet',
			'Promise',
			'Proxy',
			'Reflect',
			'ArrayBuffer',
			'Uint8Array',
			'TextEncoder',
			'TextDecoder',
			'URL',
			'URLSearchParams',
			'fetch',
			'Request',
			'Response',
			'Headers',
			'FormData',
			'AbortController',
			'structuredClone',
			'queueMicrotask',
			'setTimeout',
			'clearTimeout',
			'setInterval',
			'clearInterval',
			'crypto',
			'performance',
			'atob',
			'btoa',
			'isNaN',
			'isFinite',
			'parseInt',
			'parseFloat',
			'encodeURIComponent',
			'decodeURIComponent',
			'window',
			'document',
			'navigator',
			'location'
		];
		const src = `export const f = import.meta.og.$(function () { return [${globals.join(', ')}, arguments]; });`;
		expect(run(src).hoists[0]!.factory_src.startsWith('() =>')).toBe(true);
	});
});

describe('og.$ fn manifest', () => {
	it('is the same whatever order the modules transformed in', () => {
		const a = new Map([
			['src/b.ts#$0', '() => (2)'],
			['src/a.ts#$0', '() => (1)']
		]);
		const b = new Map([...a].reverse());
		expect(fn_manifest_registrations(a)).toBe(fn_manifest_registrations(b));
		expect(fn_manifest_entries(a).map(([tag]) => tag)).toEqual(['src/a.ts#$0', 'src/b.ts#$0']);
	});
});

describe('og.$ in a typed module hoists plain JS (#1556)', () => {
	const svelte_ts = (body: string) => dedent`
		<script lang="ts">
			const rate: number = 2;
			const f = import.meta.og.$(${body});
		</script>
	`;
	const hoist = (src: string, id = 'src/routes/p.svelte') => {
		const { hoists } = rewrite_dollar(src, id, id, SVELTE);
		expect(hoists).toHaveLength(1);
		return hoists[0]!.factory_src;
	};
	const call = (factory: string, ...args: unknown[]): unknown =>
		(new Function(`return (${factory});`)() as (...c: unknown[]) => (...a: unknown[]) => unknown)(
			2
		)(...args);

	it.each([
		['a parameter annotation and a return type', '(n: number): number => n * rate', [3], 6],
		['generics on the function and on a call', '<T,>(n: T): T => ((v: T) => v)<T>(n)', [3], 3],
		[
			'as, satisfies and a non-null !',
			'(n: unknown) => ((n as number) satisfies number)! * rate',
			[3],
			6
		],
		[
			'an instantiation expression',
			'(n: number) => { const id = <T,>(v: T) => v; const g = id<number>; return g(n); }',
			[3],
			3
		],
		['an angle-bracket assertion', '(n: unknown) => <number>n * rate', [3], 6],
		['an optional parameter', '(n?: number) => (n ?? 1) * rate', [undefined], 2],
		['a definite assignment', '(n: number) => { let x!: number; x = n; return x * rate; }', [3], 6],
		[
			'a local type alias and interface',
			'(n: number) => { type X = number; interface Y { a: X } const y: Y = { a: n }; return y.a; }',
			[3],
			3
		],
		[
			'a declare and an overload',
			'(n: number) => { declare const z: number; function g(a: number): number; function g(a: number) { return a; } return g(n); }',
			[3],
			3
		],
		[
			'a this parameter',
			'(n: number) => { const o = { k: n, m(this: { k: number }, a?: number) { return this.k + (a ?? 0); } }; return o.m(); }',
			[3],
			3
		],
		[
			'class modifiers, abstract members and implements',
			'(n: number) => { interface I { v: number } abstract class A { abstract w(): void; abstract x: number; abstract accessor y: number; } class C extends A implements I { private readonly p?: number; declare q: number; public v: number = n; [k: string]: unknown; override w() {} protected m!: number; } return new C().v; }',
			[3],
			3
		],
		[
			'a type-only namespace',
			'(n: number) => { namespace T { export type V = number } const v: T.V = n; return v; }',
			[3],
			3
		]
	])('%s', (_name, body, args, expected) => {
		expect(call(hoist(svelte_ts(body)), ...args)).toBe(expected);
	});

	it('a typed markup mark hoists plain JS', () => {
		const src = dedent`
			<script lang="ts">
				const rate = 2;
			</script>
			<Island fmt={import.meta.og.$((n?: number): number => (n ?? 1) * rate)} />
		`;
		expect(call(hoist(src), 3)).toBe(6);
	});

	it('a typed value mark asserts the plain expression', () => {
		const src = dedent`
			type S = { v: number };
			const s = { v: 1 };
			export const x = import.meta.og.$(<S>s);
		`;
		expect(run(src).code).toMatch(/__og_boundary\(\(\s+s\), "src\/routes\/x\.ts:3"\)/);
	});

	it.each([
		['an enum', '() => { enum E { A } return E.A; }', /enum/],
		[
			'a namespace with values',
			'() => { namespace N { export const v = 1 } return N.v; }',
			/namespace/
		],
		[
			'a parameter property',
			'() => { class C { constructor(public v: number) {} } return new C(1).v; }',
			/parameter property/
		]
	])('TS with runtime meaning (%s) fails the build at its line', (_name, body, problem) => {
		expect(() =>
			rewrite_dollar(svelte_ts(body), 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE)
		).toThrow(problem);
		expect(() =>
			rewrite_dollar(svelte_ts(body), 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE)
		).toThrow(/p\.svelte:3/);
	});
});

describe('og.$ in a typed module hoists plain JS (#1556)', () => {
	const svelte_ts = (body: string) => dedent`
		<script lang="ts">
			const rate: number = 2;
			const f = import.meta.og.$(${body});
		</script>
	`;
	const hoist = (src: string, id = 'src/routes/p.svelte') => {
		const { hoists } = rewrite_dollar(src, id, id, SVELTE);
		expect(hoists).toHaveLength(1);
		return hoists[0]!.factory_src;
	};
	const call = (factory: string, ...args: unknown[]): unknown =>
		(new Function(`return (${factory});`)() as (...c: unknown[]) => (...a: unknown[]) => unknown)(
			2
		)(...args);

	it.each([
		['a parameter annotation and a return type', '(n: number): number => n * rate', [3], 6],
		['generics on the function and on a call', '<T,>(n: T): T => ((v: T) => v)<T>(n)', [3], 3],
		[
			'as, satisfies and a non-null !',
			'(n: unknown) => ((n as number) satisfies number)! * rate',
			[3],
			6
		],
		[
			'an instantiation expression',
			'(n: number) => { const id = <T,>(v: T) => v; const g = id<number>; return g(n); }',
			[3],
			3
		],
		['an angle-bracket assertion', '(n: unknown) => <number>n * rate', [3], 6],
		['an optional parameter', '(n?: number) => (n ?? 1) * rate', [undefined], 2],
		['a definite assignment', '(n: number) => { let x!: number; x = n; return x * rate; }', [3], 6],
		[
			'a local type alias and interface',
			'(n: number) => { type X = number; interface Y { a: X } const y: Y = { a: n }; return y.a; }',
			[3],
			3
		],
		[
			'a declare and an overload',
			'(n: number) => { declare const z: number; function g(a: number): number; function g(a: number) { return a; } return g(n); }',
			[3],
			3
		],
		[
			'a this parameter',
			'(n: number) => { const o = { k: n, m(this: { k: number }, a?: number) { return this.k + (a ?? 0); } }; return o.m(); }',
			[3],
			3
		],
		[
			'class modifiers, abstract members and implements',
			'(n: number) => { interface I { v: number } abstract class A { abstract w(): void; abstract x: number; abstract accessor y: number; } class C extends A implements I { private readonly p?: number; declare q: number; public v: number = n; [k: string]: unknown; override w() {} protected m!: number; } return new C().v; }',
			[3],
			3
		],
		[
			'a type-only namespace',
			'(n: number) => { namespace T { export type V = number } const v: T.V = n; return v; }',
			[3],
			3
		]
	])('%s', (_name, body, args, expected) => {
		expect(call(hoist(svelte_ts(body)), ...args)).toBe(expected);
	});

	it('a typed markup mark hoists plain JS', () => {
		const src = dedent`
			<script lang="ts">
				const rate = 2;
			</script>
			<Island fmt={import.meta.og.$((n?: number): number => (n ?? 1) * rate)} />
		`;
		expect(call(hoist(src), 3)).toBe(6);
	});

	it('a typed value mark asserts the plain expression', () => {
		const src = dedent`
			type S = { v: number };
			const s = { v: 1 };
			export const x = import.meta.og.$(<S>s);
		`;
		expect(run(src).code).toMatch(/__og_boundary\(\(\s+s\), "src\/routes\/x\.ts:3"\)/);
	});

	it.each([
		['an enum', '() => { enum E { A } return E.A; }', /enum/],
		[
			'a namespace with values',
			'() => { namespace N { export const v = 1 } return N.v; }',
			/namespace/
		],
		[
			'a parameter property',
			'() => { class C { constructor(public v: number) {} } return new C(1).v; }',
			/parameter property/
		]
	])('TS with runtime meaning (%s) fails the build at its line', (_name, body, problem) => {
		expect(() =>
			rewrite_dollar(svelte_ts(body), 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE)
		).toThrow(problem);
		expect(() =>
			rewrite_dollar(svelte_ts(body), 'src/routes/p.svelte', 'src/routes/p.svelte', SVELTE)
		).toThrow(/p\.svelte:3/);
	});
});
