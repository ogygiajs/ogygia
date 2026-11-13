/**
 * ADVERSARIAL stress suite for `import.meta.og.bake`: every input either does the RIGHT thing or
 * FAILS LOUDLY (build-voice error), never silently corrupts, never mistakes a comment/string for a
 * call, never emits unbalanced output. (Core's `wire` has its half in
 * packages/compiler/test/og-constructs-stress.test.ts.)
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __set_build_cache_root, dedent } from '@ogygia/compiler';
import { rewrite_bake } from '../src/bake.ts';

function balanced(s: string): boolean {
	let r = 0,
		c = 0;
	for (const ch of s) {
		if (ch === '(') r++;
		else if (ch === ')') r--;
		else if (ch === '{') c++;
		else if (ch === '}') c--;
	}
	return r === 0 && c === 0;
}

describe('bake — byte-offset integrity under multi-byte unicode', () => {
	beforeAll(() => __set_build_cache_root(fs.mkdtempSync(path.join(os.tmpdir(), 'og-off-'))));

	it('TWO bake() calls interleaved with unicode both inline at the right spots', async () => {
		const src = dedent`
			const a = "café";
			const m = import.meta.og.bake(() => 1);
			const b = "naïve 🔥";
			const n = import.meta.og.bake(() => 2);
			export { m, n };
		`;
		const out = await rewrite_bake(src, '/app/x.ts', { alias: [], root: '/app' });
		expect(out).toContain(`const a = "café";`);
		expect(out).toContain(`const b = "naïve 🔥";`);
		expect(out).toContain('const m = (1)');
		expect(out).toContain('const n = (2)');
		expect(out).not.toContain('import.meta.og.bake');
	});
});

describe('misuse-error QUALITY — build-voice, file:line, explains the fix', () => {
	it('bake with a non-function arg → must be a function + line', async () => {
		await expect(
			rewrite_bake('\nconst v = import.meta.og.bake({});', '/b.ts', { alias: [], root: '/app' })
		).rejects.toThrow(/b\.ts:2.*must be a function/);
	});
	it('bake with wrong arity → takes exactly one argument', async () => {
		await expect(
			rewrite_bake('const v = import.meta.og.bake(() => 1, 2);', '/b.ts', {
				alias: [],
				root: '/app'
			})
		).rejects.toThrow(/takes exactly one argument/);
	});
});

describe('bake in .svelte — component import excluded from the eval bundle', () => {
	let dir: string;
	beforeAll(() => {
		__set_build_cache_root(fs.mkdtempSync(path.join(os.tmpdir(), 'og-sv-bake-cache-')));
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-sv-bake-'));
		fs.writeFileSync(
			path.join(dir, 'Widget.svelte'),
			`<script>let { n } = $props();</script><b>{n}</b>`
		);
		fs.writeFileSync(path.join(dir, 'nums.ts'), `export const NUMS = [1, 2, 3];`);
	});
	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

	it('the .svelte component import stays out of the Node eval; the bake still resolves its data', async () => {
		const src = dedent`
			<script lang="ts">
			import Widget from './Widget.svelte';
			import { NUMS } from './nums';
			const total = import.meta.og.bake(() => NUMS.reduce((a, b) => a + b, 0));
			</script>
			<Widget n={total} />
		`;
		const out = await rewrite_bake(src, path.join(dir, 'C.svelte'), { alias: [], root: dir });
		expect(out).toContain('const total = (6)'); // 1+2+3, bake resolved through the data import
		expect(out).toContain(`import Widget from './Widget.svelte';`); // component import kept (used in markup)
		expect(out).not.toContain('import.meta.og.bake');
	});
});

describe('bake — devalue serialization torture (real execution)', () => {
	beforeAll(() =>
		__set_build_cache_root(fs.mkdtempSync(path.join(os.tmpdir(), 'og-bake-stress-')))
	);
	const opts = { alias: [], root: '/app' };
	const bake = (expr: string) =>
		rewrite_bake(
			`const v = import.meta.og.bake(() => (${expr}));\nexport { v };`,
			'/app/x.ts',
			opts
		);

	it('exotic primitives: undefined, NaN, Infinity, -0, BigInt', async () => {
		expect(await bake('undefined')).toContain('const v = (void 0)');
		expect(await bake('NaN')).toContain('NaN');
		expect(await bake('Infinity')).toContain('Infinity');
		expect(await bake('10n')).toContain('10n');
	});

	it('Date, Map, Set, RegExp round-trip', async () => {
		expect(await bake('new Date(0)')).toContain('new Date(0)');
		expect(await bake('new Map([["a",1]])')).toContain('new Map');
		expect(await bake('new Set([1,2])')).toContain('new Set');
		// devalue serializes a RegExp as `new RegExp("ab+c","gi")` — equivalent, not literal syntax.
		expect(await bake('/ab+c/gi')).toContain('new RegExp("ab+c","gi")');
	});

	it('a CIRCULAR structure serializes (devalue references)', async () => {
		const out = await bake('(() => { const o = {}; o.self = o; return o; })()');
		expect(out).not.toContain('import.meta.og.bake');
		expect(balanced(out)).toBe(true);
	});

	it('nested + sparse arrays and unicode strings', async () => {
		const out = await bake(
			'({ a: [1, , 3], s: "caf\\u00e9 \\ud83d\\udd25", deep: { x: [{ y: 1 }] } })'
		);
		expect(out).not.toContain('import.meta.og.bake');
		expect(balanced(out)).toBe(true);
	});

	it('a function in the result FAILS LOUDLY', async () => {
		await expect(bake('({ fn: () => 1 })')).rejects.toThrow(/not serializable/);
	});

	it('a Symbol in the result FAILS LOUDLY', async () => {
		await expect(bake('Symbol("x")')).rejects.toThrow(/not serializable/);
	});

	it('a fn that THROWS at build surfaces as a build error', async () => {
		await expect(bake('(() => { throw new Error("boom"); })()')).rejects.toThrow(
			/boom|evaluating the function failed/
		);
	});

	it('referencing an undeclared/non-imported name FAILS LOUDLY', async () => {
		await expect(bake('someUndeclaredGlobalThing')).rejects.toThrow(
			/evaluating the function failed/
		);
	});

	it('typed array (Uint8Array) and ArrayBuffer serialize', async () => {
		expect(await bake('new Uint8Array([1,2,3])')).toContain('new Uint8Array([1,2,3])');
		expect(await bake('new ArrayBuffer(4)')).toContain('.buffer');
	});

	it('nested Map-of-Sets and a getter (evaluated) serialize', async () => {
		expect(await bake('new Map([["a", new Set([1,2])]])')).toContain(
			'new Map([["a",new Set([1,2])]])'
		);
		const g = await bake(
			'(() => { const o = {}; Object.defineProperty(o, "x", { get: () => 5, enumerable: true }); return o; })()'
		);
		expect(g).toContain('{x:5}'); // getter value inlined, not the accessor
	});

	it('a frozen object and a 10k-element array both inline', async () => {
		expect(await bake('Object.freeze({ a: 1, b: 2 })')).toContain('{a:1,b:2}');
		const big = await bake('Array.from({ length: 10000 }, (_, i) => i)');
		expect(big).not.toContain('import.meta.og.bake');
		expect(big).toContain('9999'); // last element present
		expect(balanced(big)).toBe(true);
	});

	it('an async fn using await Promise.all([...]) resolves', async () => {
		// `await` needs an async fn — a sync `() => await …` is a syntax error (caught upstream).
		const src = `const v = import.meta.og.bake(async () => await Promise.all([Promise.resolve(1), Promise.resolve(2)]));\nexport { v };`;
		const out = await rewrite_bake(src, '/app/x.ts', { alias: [], root: '/app' });
		expect(out).toContain('const v = ([1,2])');
	});
});

describe('bake — resolution depth (real execution, real files)', () => {
	let dir: string;
	beforeAll(() => {
		__set_build_cache_root(fs.mkdtempSync(path.join(os.tmpdir(), 'og-bake-depth-cache-')));
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-bake-depth-'));
		// c imports b imports a — transitive resolution through the eval bundle.
		fs.writeFileSync(path.join(dir, 'a.ts'), `export const A = 10;`);
		fs.writeFileSync(path.join(dir, 'b.ts'), `import { A } from './a'; export const B = A * 2;`);
		fs.writeFileSync(
			path.join(dir, 'c.ts'),
			`import { B } from './b'; export function chain() { return B + 1; }`
		);
	});
	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
	const opts = () => ({ alias: [], root: dir });

	it('a fn importing a sibling that imports another sibling (transitive)', async () => {
		const src = dedent`
			import { chain } from './c';
			const v = import.meta.og.bake(() => chain());
			export { v };
		`;
		const out = await rewrite_bake(src, path.join(dir, 'mod.ts'), opts());
		expect(out).toContain('const v = (21)'); // (10*2)+1
		expect(out).not.toContain(`import { chain }`); // dead after baking → dropped
	});

	it('a fn importing and using a node: builtin', async () => {
		const src = dedent`
			import path from 'node:path';
			const v = import.meta.og.bake(() => path.join('a', 'b', 'c'));
			export { v };
		`;
		const out = await rewrite_bake(src, path.join(dir, 'mod.ts'), opts());
		expect(out).toContain('const v = ("a/b/c")');
	});
});
