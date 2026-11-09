// The module-level map check (./module-maps.ts): each allowed form passes, each refused one is named
// with its line and its fix. Run by plain node: `node --test internal/checks/module-maps.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { find_unowned } from './module-maps.ts';

const names = (source: string): string[] =>
	find_unowned('x.ts', source).map((f) => `${f.line}:${f.name}:${f.kind}`);

test('a module-level Map, Set or empty array is refused, by line and name', () => {
	assert.deepEqual(
		names(
			[
				'const seen = new Map<string, number>();',
				'export const ids = new Set();',
				'let queue: string[] = [];'
			].join('\n')
		),
		['1:seen:Map', '2:ids:Set', '3:queue:array']
	);
});

test('one pinned on a global is refused too', () => {
	assert.deepEqual(names('const all = (globalThis.__x ??= new Map());'), ['1:all:Map']);
});

test('a cache() is allowed', () => {
	assert.deepEqual(names('const pages = cache<string, string>({ max: 10 });'), []);
});

test("a fixed table marked '// static: <reason>' is allowed; a mark with no reason is not", () => {
	assert.deepEqual(
		names(
			[
				'// static: the message codes, filled once at load',
				'const CODES = new Set(["a", "b"]);',
				'// static:',
				'const EMPTY = new Set();',
				'const LIMITS = new Map([["a", 1]]); // static: three fixed limits'
			].join('\n')
		),
		['4:EMPTY:Set']
	);
});

test("one owned by a scope, marked '// owned: <scope>', is allowed", () => {
	assert.deepEqual(
		names(
			[
				'// owned: the page visit clears it (visit.scope.defer)',
				'const per_visit = new Map();'
			].join('\n')
		),
		[]
	);
});

test('a WeakMap, a WeakSet, and maps made inside functions are not module-level growth', () => {
	assert.deepEqual(
		names(
			[
				'const notes = new WeakMap();',
				'const marks = new WeakSet();',
				'function make() { const m = new Map(); return m; }',
				'const f = () => new Set();',
				'const list = [1, 2, 3];'
			].join('\n')
		),
		[]
	);
});

test('each finding says the fix', () => {
	const [f] = find_unowned('x.ts', 'const seen = new Map();');
	assert.match(f!.fix, /cache\(\)/);
	assert.match(f!.fix, /\/\/ static:/);
});
