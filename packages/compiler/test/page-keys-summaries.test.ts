// summarize_export's EXACT answers: which export it finds, under which local name, and where a
// re-export says to follow. 'all' is always sound, so the soundness suite cannot tell a helper the
// analysis gave up on from one it read; every row here pins the precise answer (a needless 'all'
// ships the whole page seed). Rows the mutation pass found unpinned.
import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import {
	follow_pending_page_calls,
	page_data_keys,
	page_data_keys_answer,
	summarize_export,
	type AllReason,
	type ExportSummary,
	type PageKeys,
	type PendingCall
} from '../src/compiler/link/page-keys.ts';

const b = new Set(['b']);
const none = new Set<string>();

const ROWS: [string, string, number, ExportSummary][] = [
	// the export is a function of this module, under its own name or another
	['export function h(p) { return p.data.b; }', 'h', 0, b],
	['export const h = (p) => p.data.b;', 'h', 0, b],
	['export const h = function (p) { return p.data.b; };', 'h', 0, b],
	['export const a = (p) => p.data.a, h = (p) => p.data.b;', 'h', 0, b],
	['function g(p) { return p.data.b; }\nexport { g as h };', 'h', 0, b],
	['const g = (p) => p.data.b;\nexport { g as h };', 'h', 0, b],
	['const g = function (p) { return p.data.b; };\nexport { g as h };', 'h', 0, b],
	['export function h(a, p) { return p.data.b + a.data.a; }', 'h', 1, new Set(['b'])],
	['export function h(a, p) { return p.url; }', 'h', 1, none],
	// a nested function of the same name is not the export
	[
		dedent`
			function outer() { function g(p) { return p.url; } return g; }
			function g(p) { return p.data.b; }
			export { g as h };
		`,
		'h',
		0,
		b
	],
	[
		dedent`
			function outer() { const g = (p) => p.url; return g; }
			const g = (p) => p.data.b;
			export { g as h };
		`,
		'h',
		0,
		b
	],
	// not a function this module declares: follow, or give up
	["export { g as h } from './x';", 'h', 0, { follow: ['./x'], imported: 'g' }],
	["export { h } from './x';", 'h', 0, { follow: ['./x'], imported: 'h' }],
	["import { g } from './x';\nexport { g as h };", 'h', 0, { follow: ['./x'], imported: 'g' }],
	["import { k as g } from './x';\nexport { g as h };", 'h', 0, { follow: ['./x'], imported: 'k' }],
	["export * from './a';\nexport { h } from './b';", 'h', 0, { follow: ['./b'], imported: 'h' }],
	["export { h } from './b';\nexport * from './a';", 'h', 0, { follow: ['./b'], imported: 'h' }],
	["export * from './a';\nexport function h(p) { return p.data.b; }", 'h', 0, b],
	['export const h = 1;', 'h', 0, 'all'],
	['export const h = (p) => p.data.b;', 'k', 0, 'all'],
	['export class h { constructor(p) { this.b = p.data.b; } }', 'h', 0, 'all'],
	['export function h(p) { return p.data.b;', 'h', 0, 'all'],
	// an import is not an `export *`, and another exported function is not the one asked for
	["import { g } from './x';\nexport const k = 1;", 'h', 0, 'all'],
	['export function h(p) { return p.data.b; }\nexport function k(p) { return p.url; }', 'h', 0, b]
];

describe('summarize_export answers exactly', () => {
	it.each(ROWS)('%s (%s, arg %i)', (code, name, arg, want) => {
		expect(summarize_export(code, '/app/src/lib/h.ts', 'script', name, arg)).toEqual(want);
	});

	it('reads a component module script', () => {
		const code = dedent`
			<script module>
				export function h(p) { return p.data.b; }
			</script>
			<p>hi</p>
		`;
		expect(summarize_export(code, '/app/src/lib/H.svelte', 'svelte', 'h', 0)).toEqual(b);
	});

	it.each([
		// a function expression of this module is followed like an arrow or a declaration
		['const f = function (p) { return p.data.b; };\nuse(f(page));', ['b']],
		// `arguments` outside a function handed the page reaches nothing of it
		['function f() { return arguments.length; }\nuse(f(), page.data.b);', ['b']],
		// a module that does not parse ships all
		['use(page.data.b);\nconst = ;', 'all']
	])('page_data_keys: %s', (body, want) => {
		const code = `import { page } from '$app/state';\n${body}`;
		const { keys } = page_data_keys_answer(code, '/app/src/lib/x.ts', 'script');
		expect(keys === 'all' ? 'all' : [...(keys ?? [])].sort()).toEqual(want);
	});

	it('a default-imported helper handed the page is followed by its default export', () => {
		const code = dedent`
			import { page } from '$app/state';
			import h from './h';
			use(h(page));
		`;
		const { keys, pending } = page_data_keys_answer(code, '/app/src/lib/x.ts', 'script');
		expect(keys).toEqual(new Set());
		expect(pending).toEqual([{ specifier: './h', imported: 'default', arg: 0, line: 3 }]);
	});

	it("names the line of the read that ships all, not the module's last", () => {
		const code = dedent`
			import { page } from '$app/state';
			const d = page.data;
			export const a = d.a;
			export const b = 1;
		`;
		expect(page_data_keys_answer(code, '/app/src/lib/x.ts', 'script').reason?.line).toBe(2);
	});

	it('a component that does not parse gives up', () => {
		expect(summarize_export('<script>{</script>', '/app/src/lib/H.svelte', 'svelte', 'h', 0)).toBe(
			'all'
		);
	});
});

/** Reads the browser can take must count: only a test that is true on the server alone
 *  (`typeof window === 'undefined'`, `import.meta.env.SSR`) or its negation picks a side. */
describe('a read in a branch the browser can take counts', () => {
	it.each([
		'if (!flag) use(page.data.b);',
		'if (!!flag) use(page.data.b);',
		'if (flag) use(page.data.b);',
		'flag && use(page.data.b);',
		"if (typeof window === 'undefined') {} else use(page.data.b);",
		"if (typeof window !== 'undefined') use(page.data.b);",
		"if (typeof window != 'undefined') use(page.data.b);",
		"if ('undefined' !== typeof document) use(page.data.b);",
		"if (!(typeof window === 'undefined')) use(page.data.b);",
		"if (typeof window === 'object') use(page.data.b);",
		"if (typeof foo === 'undefined') use(page.data.b);",
		"if (typeof window === 'string') use(page.data.b);",
		"if (typeof window < 'undefined') use(page.data.b);",
		"if (void window === 'undefined') use(page.data.b);",
		"use(typeof window === 'undefined' ? 0 : page.data.b);",
		'if (import.meta.env.DEV) use(page.data.b);',
		'if (env.SSR) use(page.data.b);',
		'if (import.meta.env[SSR]) use(page.data.b);',
		'if (!import.meta.env.SSR) use(page.data.b);',
		'if (import.meta.env.SSR) {} else use(page.data.b);'
	])('%s', (body) => {
		const code = `import { page } from '$app/state';\n${body}`;
		const keys = page_data_keys(code, '/app/src/lib/x.ts', 'script');
		expect(keys === 'all' || keys?.has('b'), JSON.stringify(keys && [...keys])).toBe(true);
	});

	it.each([
		"if (typeof window === 'undefined') use(page.data.b);",
		"if (typeof document == 'undefined') use(page.data.b);",
		"if ('undefined' === typeof window) use(page.data.b);",
		"if (!(typeof window !== 'undefined')) use(page.data.b);",
		'if (import.meta.env.SSR) use(page.data.b);',
		"typeof window === 'undefined' && use(page.data.b);",
		"use(typeof window === 'undefined' ? page.data.b : 0);"
	])('%s is server only', (body) => {
		const code = dedent`
			import { page } from '$app/state';
			use(page.data.a);
			${body}
		`;
		expect(page_data_keys(code, '/app/src/lib/x.ts', 'script')).toEqual(new Set(['a']));
	});
});

/** A local function rebound by any assignment form may run another body: never followed. */
describe('a followed function rebound by destructuring is not followed', () => {
	it.each([
		'({ f } = { f: (p) => p.data.b });',
		'({ x: f } = { x: (p) => p.data.b });',
		'({ f = (p) => p.data.b } = {});',
		'[f] = [(p) => p.data.b];',
		'[f = (p) => p.data.b] = [];',
		'[...[f]] = [(p) => p.data.b];',
		'({ ...f } = {});',
		'((f) = (p) => p.data.b);',
		'(f as any) = (p) => p.data.b;'
	])('%s', (rebind) => {
		const code = dedent`
			import { page } from '$app/state';
			let f = (p) => p.url;
			${rebind}
			use(f(page));
		`;
		const keys = page_data_keys(code, '/app/src/lib/x.ts', 'script');
		expect(keys === 'all' || keys?.has('b'), JSON.stringify(keys && [...keys])).toBe(true);
	});
});

describe('a renamed re-export is followed under its source name', () => {
	it('`export { g as h }` looks for g, not h, in the source module', async () => {
		const files: Record<string, string> = {
			'/r/barrel.ts': "export { g as h } from './impl';",
			'/r/impl.ts': dedent`
				export function g(p) { return p.data.b; }
				export function h(p) { return p.url; }
			`
		};
		const program = {
			page_keys: new Map<string, PageKeys>([['/app/A.ts', new Set()]]),
			page_key_reasons: new Map<string, AllReason>(),
			page_pending: new Map<string, PendingCall[]>([
				['/app/A.ts', [{ specifier: '/r/barrel', imported: 'h', arg: 0, line: 2 }]]
			])
		};
		await follow_pending_page_calls(
			program,
			async (spec, importer) => ({
				id: spec.startsWith('./')
					? `${importer.replace(/[^/]+$/, '')}${spec.slice(2)}.ts`
					: `${spec}.ts`
			}),
			(f) => files[f] ?? null
		);
		expect(program.page_keys.get('/app/A.ts')).toEqual(new Set(['b']));
	});
});
