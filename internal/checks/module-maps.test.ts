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
		['1:seen:Map', '2:ids:Set', '3:queue:let']
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

test('a trailing mark is its own line only: the declaration after it is not marked by it', () => {
	assert.deepEqual(
		names(
			[
				'const LIMITS = new Map([["a", 1]]); // static: three fixed limits',
				'const seen = new Map();',
				'let x = 1; // static: not a table',
				'const also = new Set();'
			].join('\n')
		),
		['2:seen:Map', '4:also:Set']
	);
});

test('a comment claiming ownership is no pass: one owned by a scope lives in its owner', () => {
	assert.deepEqual(
		names(
			[
				'// owned: the page visit clears it (visit.scope.defer)',
				'const per_visit = new Map();',
				'class Session { #seen = new Map(); }',
				'function visit(scope) { const per_visit = new Map(); scope.defer(() => per_visit.clear()); }'
			].join('\n')
		),
		['2:per_visit:Map']
	);
});

test('a static table that the module grows is an error, by its write', () => {
	const found = find_unowned(
		'x.ts',
		[
			'// static: the codes',
			'const CODES = new Set(["a"]);',
			'// static: the limits',
			'const LIMITS = new Map();',
			'// static: the queue',
			'const QUEUE = [];',
			'// static: by index',
			'const SLOTS = [];',
			'function later(k) { CODES.add(k); LIMITS.set(k, 1); QUEUE.push(k); SLOTS[k] = 1; }',
			'// static: read only',
			'const READ = new Set(["x"]);',
			'const has = (k) => READ.has(k);'
		].join('\n')
	);
	assert.deepEqual(
		found.map((f) => `${f.line}:${f.name}:${f.kind}`),
		[
			'9:CODES:static-grown',
			'9:LIMITS:static-grown',
			'9:QUEUE:static-grown',
			'9:SLOTS:static-grown'
		]
	);
	assert.match(found[0]!.fix, /static/);
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

test('a module-level let holding a collection is growth (it is reassigned), unless it is a cache()', () => {
	assert.deepEqual(
		names(
			[
				'let observers: readonly Function[] = [];',
				'// static: a fixed list',
				'let FIXED = ["a", "b"];',
				'let seen = new Map([["a", 1]]);',
				'let found = new Set(["x"]);',
				'let pages = cache({ max: 10 });',
				'let count = 0;',
				'let name: string | null = null;',
				'function on(o) { observers = [...observers, o]; seen = new Map(seen); FIXED = FIXED.concat(o); found ||= new Set(); }'
			].join('\n')
		),
		['1:observers:let', '3:FIXED:let', '4:seen:let', '5:found:let']
	);
});

test('a static table must be const', () => {
	const [f] = find_unowned(
		'x.ts',
		['// static: the codes', 'let CODES = new Set(["a"]);'].join('\n')
	);
	assert.equal(f?.kind, 'let');
	assert.match(f!.fix, /const/);
});

test('a registry() is allowed: its entries are owned, never evicted', () => {
	assert.deepEqual(names('const watchers = registry<Function>();'), []);
});

test('a literal max: Infinity is refused anywhere in the module (no bound is no bound)', () => {
	assert.deepEqual(
		names(
			[
				'const pages = cache({ max: Infinity });',
				'function make() { return flights({ run, max: Infinity }); }',
				'const ok = cache({ max: 64 });'
			].join('\n')
		),
		['1:max:infinite-max', '2:max:infinite-max']
	);
});

test('each finding says the fix', () => {
	const [f] = find_unowned('x.ts', 'const seen = new Map();');
	assert.match(f!.fix, /cache\(\)/);
	assert.match(f!.fix, /\/\/ static:/);
	assert.match(f!.fix, /owner/);
	assert.doesNotMatch(f!.fix, /\/\/ owned:/);
});
