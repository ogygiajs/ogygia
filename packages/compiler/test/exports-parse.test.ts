/**
 * Module analysis on the compiler's parser: what an importer imports (ranges, attributes, type-only),
 * and a barrel's export shape — including the PURITY verdict that decides whether a module is a
 * barrel the pass may bypass at all. Every statement kind that can appear at the top level is
 * classified here on purpose: a wrong "pure" would drop code the app runs.
 */
import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import { analyze_exports, analyze_imports } from '../src/compiler/exports/parse.ts';

const TS = '/app/x.ts';
const JS = '/app/x.js';

describe('analyze_imports', () => {
	it('reads every specifier kind with exact source ranges', () => {
		const code = dedent`
			import d, { a, b as c, type T } from './x';
			import * as ns from './y';
			import './side';
			import type { U } from './u';
		`;
		const decls = analyze_imports(code, TS)!;
		expect(decls).toHaveLength(4);
		expect(code.slice(decls[0].start, decls[0].end)).toBe(
			`import d, { a, b as c, type T } from './x';`
		);
		expect(decls[0].specs).toEqual([
			{ kind: 'default', imported: 'default', local: 'd', type_only: false },
			{ kind: 'named', imported: 'a', local: 'a', type_only: false },
			{ kind: 'named', imported: 'b', local: 'c', type_only: false },
			{ kind: 'named', imported: 'T', local: 'T', type_only: true }
		]);
		expect(decls[1].specs[0]).toEqual({
			kind: 'namespace',
			imported: '*',
			local: 'ns',
			type_only: false
		});
		expect(decls[2]).toMatchObject({ side_effect: true, specs: [] });
		expect(decls[3]).toMatchObject({ type_only: true, source: './u' });
	});

	it('keeps the verbatim import-attributes clause (with / assert) and its keys, semicolon or not', () => {
		const a = analyze_imports(
			`import { X } from './b' with { wake: 'visible', margin: "200px" };`,
			TS
		)![0];
		expect(a.attributes).toBe(` with { wake: 'visible', margin: "200px" }`);
		expect(a.attribute_keys).toEqual(['wake', 'margin']);
		const b = analyze_imports(`import { X } from './b' with { wake: 'load' }\nconst y = 1`, TS)![0];
		expect(b.attributes).toBe(` with { wake: 'load' }`);
		const c = analyze_imports(`import j from './j.json' assert { type: 'json' };`, JS)![0];
		expect(c.attributes).toBe(` assert { type: 'json' }`);
		expect(c.attribute_keys).toEqual(['type']);
		const d = analyze_imports(`import { X } from './b';`, TS)![0];
		expect(d.attributes).toBe('');
		expect(d.attribute_keys).toEqual([]);
		const e = analyze_imports(`import { X } from './b' with { 'wake': 'load' };`, TS)![0];
		expect(e.attribute_keys, 'a quoted key is still the key').toEqual(['wake']);
	});

	it('handles the cursed spellings: no semicolons, no spaces, comments inside, unicode, `default as`', () => {
		const code = dedent`
			import{a}from"./x"
			import {
			  /* c */ b, // trailing
			  c as d
			} from './y'
			import { ünïcode } from './u';
			import { default as Q } from './q';
		`;
		const decls = analyze_imports(code, JS)!;
		expect(decls.map((d) => d.source)).toEqual(['./x', './y', './u', './q']);
		expect(decls[1].specs.map((s) => s.local)).toEqual(['b', 'd']);
		expect(decls[2].specs[0].local).toBe('ünïcode');
		expect(decls[3].specs[0]).toEqual({
			kind: 'named',
			imported: 'default',
			local: 'Q',
			type_only: false
		});
	});

	it('ignores dynamic imports and require calls (not declarations)', () => {
		expect(analyze_imports(`const m = await import('./x'); const r = require('./y');`, JS)).toEqual(
			[]
		);
	});

	it('returns null on a syntax error (the real compiler reports it)', () => {
		expect(analyze_imports(`import { from './x'`, TS)).toBeNull();
	});
});

describe('analyze_exports — shape + purity', () => {
	it('a classic barrel is pure: named re-exports, default-as-name, star, star-as-namespace, type re-exports', () => {
		const s = analyze_exports(
			dedent`
				export { a, b as c } from './ab';
				export { default as Button } from './Button.svelte';
				export * from './all';
				export * as ns from './ns';
				export type { T } from './t';
				export type * from './types';
				export {};
			`,
			TS
		)!;
		expect(s.pure).toBe(true);
		expect(s.exports).toEqual([
			{ kind: 'reexport', exported: 'a', imported: 'a', source: './ab', type_only: false },
			{ kind: 'reexport', exported: 'c', imported: 'b', source: './ab', type_only: false },
			{
				kind: 'reexport',
				exported: 'Button',
				imported: 'default',
				source: './Button.svelte',
				type_only: false
			},
			{ kind: 'star', source: './all', type_only: false },
			{ kind: 'star_ns', exported: 'ns', source: './ns' },
			{ kind: 'reexport', exported: 'T', imported: 'T', source: './t', type_only: true },
			{ kind: 'star', source: './types', type_only: true }
		]);
	});

	it('import-then-export is a re-export through the binding (named, default, namespace)', () => {
		const s = analyze_exports(
			dedent`
				import { a as x } from './a';
				import d from './d';
				import * as n from './n';
				export { x as y, d, n };
				export default d;
			`,
			TS
		)!;
		expect(s.pure).toBe(true);
		expect(s.exports).toEqual([
			{ kind: 'reexport', exported: 'y', imported: 'a', source: './a', type_only: false },
			{ kind: 'reexport', exported: 'd', imported: 'default', source: './d', type_only: false },
			{ kind: 'star_ns', exported: 'n', source: './n' },
			{
				kind: 'reexport',
				exported: 'default',
				imported: 'default',
				source: './d',
				type_only: false
			}
		]);
	});

	it('type declarations do not make a module impure; enums do', () => {
		expect(
			analyze_exports(
				dedent`
					export type A = 1;
					interface I {}
					export interface J {}
					export { x } from './x';
				`,
				TS
			)!.pure
		).toBe(true);
		expect(analyze_exports(`export enum E { A }\nexport { x } from './x';`, TS)!.pure).toBe(false);
		expect(
			analyze_exports(`declare module 'x' { export const y: 1 }\nexport { x } from './x';`, TS)!
				.pure
		).toBe(true);
	});

	it('a stray semicolon and a type-only export of a local type keep a barrel pure', () => {
		expect(analyze_exports(`export { x } from './x';;`, TS)!.pure).toBe(true);
		expect(
			analyze_exports(`type T = 1; export { type T }; export { x } from './x';`, TS)!.pure
		).toBe(true);
	});

	it.each([
		['export const { a, ...rest } = o;', ['a', 'rest']],
		['export const a = 1;', ['a']],
		['export let { a, b: c } = o;', ['a', 'c']],
		['export const [x, , ...rest] = arr;', ['x', 'rest']],
		['export function f() {}', ['f']],
		['export class C {}', ['C']],
		['export default 42;', ['default']],
		['export default function () {}', ['default']],
		['const a = 1; export { a };', ['a']],
		['export { a as "kebab-name" } from "./x"; console.log(1);', []],
		['sideEffect();', []],
		['if (x) {}', []],
		['export * from "./x"; globalThis.__registered = true;', []],
		['export { x } from "./x"; import.meta.glob("./*.svelte");', []],
		// imported for what loading them does: the barrel's import is what runs them
		['import "./theme.css"; export { default as Button } from "./Button.svelte";', []],
		['import "./polyfill"; export * from "./x";', []],
		['import * as setup from "./setup"; export { x } from "./x";', []]
	])('%s → impure, own names %j', (code, own) => {
		const s = analyze_exports(code, TS)!;
		expect(s.pure).toBe(false);
		expect([...s.own]).toEqual(own);
	});

	it('records string-literal export names verbatim (the rewriter skips them)', () => {
		const s = analyze_exports(`export { a as "kebab-name" } from './x';`, TS)!;
		expect(s.pure).toBe(true);
		expect(s.exports[0]).toMatchObject({ exported: 'kebab-name', imported: 'a' });
	});

	it('an empty module and a comments-only module are pure with no exports', () => {
		expect(analyze_exports('', TS)).toMatchObject({ pure: true, exports: [] });
		expect(analyze_exports('// nothing\n/* here */', TS)).toMatchObject({
			pure: true,
			exports: []
		});
	});

	it('a syntax error is null, not a shape', () => {
		expect(analyze_exports('export const = ;', TS)).toBeNull();
	});
});
