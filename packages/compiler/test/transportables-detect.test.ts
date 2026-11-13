// What counts as a transportable (a class with a wire codec, or an exported createContext), as read by
// the eager manifest (`moduleHasTransportable`, `svelteModuleHasTransportable`) and the appended
// registration (`appendTransportRegistrations`, `appendSvelteModuleRegistrations`). Near misses of
// each shape must not register: the registration drags an `ogygia/internal/register` import into
// the module.
import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import {
	appendSvelteModuleRegistrations,
	appendTransportRegistrations,
	moduleHasTransportable,
	svelteModuleHasTransportable
} from '../src/compiler/transportables.ts';

const CODEC = `{ encode: (c) => c.v, decode: (v) => new C(v) }`;
const reg = (src: string) => appendTransportRegistrations(src, '/app/src/lib/m.ts', '/app');
/** The `__OGT` / `__OGC` lines a module gets, in order. */
const calls_of = (src: string) => (reg(src) ?? '').split('\n').filter((l) => l.startsWith('__OG'));

describe('the wire member: only the symbol key or the raw macro call', () => {
	it.each([
		[`static [Symbol.for('ogygia.wire')] = ${CODEC};`, true],
		[`static [Symbol.for("ogygia.wire")] = ${CODEC};`, true],
		[`static wire = import.meta.og.wire(${CODEC});`, true],
		[`static [Symbol.for('ogygia.other')] = ${CODEC};`, false],
		[`static [Symbol.for(name)] = ${CODEC};`, false],
		[`static [Symbol.iterator] = ${CODEC};`, false],
		[`static [Sym.for('ogygia.wire')] = ${CODEC};`, false],
		[`static [Symbol.keyFor('ogygia.wire')] = ${CODEC};`, false],
		[`static [Symbol.for()] = ${CODEC};`, false],
		[`static [wireKey] = ${CODEC};`, false],
		[`[Symbol.for('ogygia.wire')] = ${CODEC};`, false],
		[`static wire = import.meta.og['wire'](${CODEC});`, false],
		[`static wire = import.meta['og'].wire(${CODEC});`, false],
		[`static wire = meta.og.wire(${CODEC});`, false],
		[`static wire = import.meta.og[wire](${CODEC});`, false],
		[`static wire = import.meta[og].wire(${CODEC});`, false],
		[`static wire = new.target.og.wire(${CODEC});`, false],
		[`static wire = import.meta.og.bake(${CODEC});`, false],
		[`static wire = import.meta.og.wire;`, false],
		[`static wire = ${CODEC};`, false]
	])('`%s` → registered: %s', (member, want) => {
		const calls = calls_of(`export class C { ${member} }`);
		expect(calls).toEqual(want ? ['__OGT("src/lib/m.ts#C", C);'] : []);
	});
});

describe('which classes register', () => {
	const WIRED = `static [Symbol.for('ogygia.wire')] = ${CODEC};`;

	it('exported by declaration, by `export { }` (local name), not a re-export from elsewhere', () => {
		const src = dedent`
			export class A { ${WIRED} }
			class B { ${WIRED} }
			class Hidden { ${WIRED} }
			export { B as Bee };
			export { Other } from './other.ts';
		`;
		expect(calls_of(src)).toEqual(['__OGT("src/lib/m.ts#A", A);', '__OGT("src/lib/m.ts#B", B);']);
	});

	it('a module that does not parse registers nothing (the compiler reports it)', () => {
		expect(reg(`export class A { ${WIRED} }\nconst = ;`)).toBe(null);
	});

	it('an exported name that is not a class does not register', () => {
		expect(reg(`const A = 1;\nexport { A };`)).toBe(null);
	});

	it('a module with no class keyword is not even parsed', () => {
		expect(reg(`export const wire = 'static class';`.replace('class', 'klass'))).toBe(null);
	});

	it('runs once: a module that already carries the registration is left alone', () => {
		const once = reg(`export class A { ${WIRED} }`)!;
		expect(reg(once)).toBe(null);
	});
});

describe('createContext exports are tagged', () => {
	it.each([
		[`export const cart = createContext();`, ['__OGC("src/lib/m.ts#cart", cart);']],
		[`export const cart = og.createContext();`, ['__OGC("src/lib/m.ts#cart", cart);']],
		[
			`export const a = createContext(), b = createContext();`,
			['__OGC("src/lib/m.ts#a", a);', '__OGC("src/lib/m.ts#b", b);']
		],
		[`export const cart = makeContext(); // createContext`, []],
		[`export const cart = createContext;`, []],
		[`export const cart = og['createContext']();`, []],
		[`export const [a] = createContext();`, []],
		[`const cart = createContext();\nexport { cart };`, []],
		[`export function createContext() {}`, []]
	])('`%s` → %j', (src, want) => {
		expect(calls_of(src)).toEqual(want);
	});

	it('a wire class and a context in one module: one import, both registrations', () => {
		const out = reg(dedent`
			export class C { static [Symbol.for('ogygia.wire')] = ${CODEC}; }
			export const cart = createContext();
		`)!;
		expect(out).toContain(
			`import { __register_transportable as __OGT, __tag_context as __OGC } from 'ogygia/internal/register';`
		);
		expect(out.split('\n').filter((l) => l.startsWith('__OG'))).toEqual([
			'__OGT("src/lib/m.ts#C", C);',
			'__OGC("src/lib/m.ts#cart", cart);'
		]);
	});
});

describe('moduleHasTransportable: the eager manifest signal', () => {
	it.each([
		// the registration's question (#1312): a computed static that is not the wire codec, or a class
		// not exported, registers nothing
		[`export class C { static [k] = 1; }`, false],
		[`class C { static [k] = 1; }`, false],
		[`export class C { static [Symbol.for('ogygia.wire')] = ${CODEC}; }`, true],
		[`export class C { static wire = import.meta.og.wire(${CODEC}); }`, true],
		[`export class C { [k] = 1; static x = 1; }`, false],
		[`export class C { static k = 1; }`, false],
		[`export const C = class { static [k] = 1; };`, false],
		[`export class C { x = 1; }`, false],
		[`export const x = { static: true, class: 1 };`, false],
		[`export class C {`, false],
		[`class C { static x = 1; }`, false],
		// unparsable: the safe answer (#1486)
		[`class C { static [k] = 1; }\nconst = ;`, true]
	])('`%s` → %s', (src, want) => {
		expect(moduleHasTransportable(src, '/app/src/lib/m.ts')).toBe(want);
	});
});

describe('a .svelte <script module> exporting a wire class', () => {
	const WIRED = `static [Symbol.for('ogygia.wire')] = ${CODEC};`;
	const svelte = (attrs: string) => dedent`
		<script${attrs}>
			export class Cart { ${WIRED} }
		</script>
		<script>
			let x = 1;
		</script>
		<p>{x}</p>
	`;

	it.each([
		[' module', true],
		[' lang="ts" module', true],
		[` context="module"`, true],
		[` context='module'`, true],
		['', false],
		[' lang="ts"', false]
	])('<script%s> → %s', (attrs, want) => {
		const src = svelte(attrs);
		expect(svelteModuleHasTransportable(src, '/app/src/lib/Cart.svelte')).toBe(want);
		const out = appendSvelteModuleRegistrations(src, '/app/src/lib/Cart.svelte', '/app');
		expect(out !== null).toBe(want);
	});

	it('injects the registration inside the module block, tagged by the .svelte path', () => {
		const src = svelte(' module');
		const out = appendSvelteModuleRegistrations(src, '/app/src/lib/Cart.svelte', '/app')!;
		const end = out.indexOf('</script>');
		const at = out.indexOf('__OGT("src/lib/Cart.svelte#Cart", Cart);');
		expect(at).toBeGreaterThan(-1);
		expect(at).toBeLessThan(end);
		// the instance script and markup are untouched
		expect(out.slice(end)).toBe(src.slice(src.indexOf('</script>')));
		expect(appendSvelteModuleRegistrations(out, '/app/src/lib/Cart.svelte', '/app')).toBe(null);
	});

	it('the word module outside a module script is not one', () => {
		const src = dedent`
			<script>
				class Local { static [k] = 1; }
			</script>
			<p>module</p>
		`;
		expect(svelteModuleHasTransportable(src, '/app/src/lib/L.svelte')).toBe(false);
	});

	it('a module script with a plain class registers nothing', () => {
		const src = dedent`
			<script module>
				export class Plain { static [k] = 1; }
			</script>
			<p></p>
		`;
		expect(appendSvelteModuleRegistrations(src, '/app/src/lib/P.svelte', '/app')).toBe(null);
	});
});
