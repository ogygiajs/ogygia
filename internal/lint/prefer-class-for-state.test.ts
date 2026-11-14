import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');

function reported(rel: string, source: string): number[] {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-prefer-class-'));
	try {
		const file = path.join(dir, rel);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, source);
		const config = path.join(dir, '.oxlintrc.json');
		writeFileSync(
			config,
			JSON.stringify({
				plugins: ['typescript'],
				jsPlugins: [path.join(ROOT, 'internal/lint/plugin.ts')],
				rules: { 'ogygia/prefer-class-for-state': 'warn' }
			})
		);
		let out = '';
		try {
			out = execFileSync(OXLINT, ['-c', config, '--format', 'unix', file], {
				cwd: dir,
				encoding: 'utf8'
			});
		} catch (e) {
			out = String((e as { stdout?: string }).stdout ?? '');
		}
		return [...out.matchAll(/:(\d+):\d+: .*prefer-class-for-state/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const QUERIES = `type Slot = { value: unknown; changed: number };
export function queries(name: string) {
	const table = new Map<string, Slot>();
	let revision = 0;
	let current: string | undefined;
	function slot_of(key: string): Slot {
		let slot = table.get(key);
		if (!slot) table.set(key, (slot = { value: undefined, changed: 0 }));
		return slot;
	}
	function set_input(key: string, value: unknown): boolean {
		const slot = slot_of(key);
		slot.value = value;
		slot.changed = ++revision;
		return true;
	}
	const db = {
		get revision() {
			return revision;
		},
		get: (key: string) => slot_of(key).value,
		watch(reader: () => unknown) {
			const outer = current;
			current = name;
			try {
				return reader();
			} finally {
				current = outer;
			}
		},
		set: (key: string, value: unknown) => set_input(key, value)
	};
	return db;
}
`;

test('a closure-class (state in a closure, an object of functions over it) is reported', () => {
	assert.deepEqual(reported('packages/demo/src/queries.ts', QUERIES), [2]);
	assert.deepEqual(
		reported(
			'packages/demo/src/counter.ts',
			`export const counter = () => {
	let n = 0;
	return { inc: () => n++, read: () => n };
};
function registry() {
	const seen = new Set<string>();
	return {
		add(key: string) {
			seen.add(key);
		},
		has: (key: string) => seen.has(key)
	};
}
export function list() {
	const items: string[] = [];
	const push = (x: string) => {
		items.push(x);
	};
	return { push, items };
}
export { registry };
`
		),
		[1, 5, 14]
	);
});

const LOAD_SCHEDULER = `import { machine } from '@ogygia/machine';
const drain_definition = machine<{ idle: {}; draining: {} }>()({
	idle: ['draining'],
	draining: ['idle']
});
let waiting = 0;
let in_flight_background = 0;
let in_flight_holes = 0;
let drainer = drain_definition.create();
export function ask(background: boolean, hole: boolean): () => void {
	waiting++;
	if (background) in_flight_background++;
	if (hole) in_flight_holes++;
	return () => {
		if (background) in_flight_background--;
		if (hole) in_flight_holes--;
		drain();
	};
}
function drain(): void {
	if (!waiting) return;
	drainer.go('draining');
	waiting--;
	drainer.go('idle');
}
export function reset_load_scheduler(): void {
	waiting = 0;
	in_flight_background = 0;
	in_flight_holes = 0;
	drainer.stop();
	drainer = drain_definition.create();
}
`;

test('module lets that two or more top-level functions write are reported once, at the first', () => {
	assert.deepEqual(reported('packages/demo/src/load-scheduler.ts', LOAD_SCHEDULER), [6]);
	assert.deepEqual(
		reported(
			'packages/demo/src/flag.ts',
			`let armed = false;
export const arm = () => {
	armed = true;
};
export function disarm() {
	armed = false;
}
export const is_armed = () => armed;
`
		),
		[1]
	);
});

test('a module Map, Set or array that two or more top-level functions mutate is reported', () => {
	assert.deepEqual(
		reported(
			'packages/demo/src/registry.ts',
			`const seen = new Set<string>();
const by_id = new Map<string, number>();
const order: string[] = [];
export function add(id: string, n: number): void {
	seen.add(id);
	by_id.set(id, n);
	order.push(id);
}
export const remove = (id: string): void => {
	seen.delete(id);
	by_id.delete(id);
};
export function clear_order(): void {
	order.length = 0;
}
`
		),
		[1]
	);
});

test('a readonly table, or a module collection only one function fills, is not reported', () => {
	assert.deepEqual(
		reported(
			'packages/demo/src/tables.ts',
			`const KINDS: ReadonlySet<string> = new Set(['a', 'b']);
const NAMES: ReadonlyMap<string, number> = new Map([['a', 1]]);
const LIST: readonly string[] = ['a'];
const PAIRS = [['a', 1]] as const;
const notes = new WeakMap<object, string>();
export function note(o: object, s: string): void {
	notes.set(o, s);
}
export function forget(o: object): void {
	notes.delete(o);
}
const cache = new Map<string, number>();
export function remember(key: string, n: number): void {
	cache.set(key, n);
}
export function recall(key: string): number | undefined {
	return cache.get(key);
}
export const known = (k: string) => KINDS.has(k) && NAMES.has(k) && LIST.includes(k) && PAIRS.length > 0;
`
		),
		[]
	);
});

test('a pure function with a local counter is not reported', () => {
	assert.deepEqual(
		reported(
			'packages/demo/src/sum.ts',
			`export function sum(xs: number[]): number {
	let total = 0;
	for (let i = 0; i < xs.length; i++) total += xs[i]!;
	return total;
}
export function summary(xs: number[]) {
	let n = 0;
	for (const x of xs) if (x > 0) n++;
	return { n, label: () => 'positive' };
}
`
		),
		[]
	);
});

test('a module let only one function writes is not reported (a cell and its setter)', () => {
	assert.deepEqual(
		reported(
			'packages/demo/src/current.ts',
			`export let current: string | null = null;
export function set_current(next: string | null): void {
	current = next;
}
export function read(): string | null {
	return current;
}
let seq = 0;
export const next_id = () => ++seq;
export function peek() {
	return seq;
}
`
		),
		[]
	);
});

test('machine definitions, Svelte runes, plugin objects and classes are not reported', () => {
	assert.deepEqual(
		reported(
			'packages/demo/src/machine.ts',
			`import { machine } from '@ogygia/machine';
export const door = machine<{ open: {}; shut: {} }>()({ open: ['shut'], shut: ['open'] });
export function door_with_count() {
	let opened = 0;
	return machine<{ open: {}; shut: {} }>()({
		open: { to: ['shut'], enter: () => void opened++ },
		shut: ['open']
	});
}
`
		),
		[]
	);
	assert.deepEqual(
		reported(
			'packages/demo/src/store.svelte.ts',
			`let count = $state(0);
export function inc() {
	count++;
}
export function reset() {
	count = 0;
}
export function box(start: number) {
	let value = $state(start);
	return {
		get value() {
			return value;
		},
		set: (next: number) => {
			value = next;
		}
	};
}
`
		),
		[]
	);
	assert.deepEqual(
		reported(
			'packages/demo/src/vite.ts',
			`export function demo_plugin() {
	let root = '';
	return {
		name: 'demo',
		configResolved(config: { root: string }) {
			root = config.root;
		},
		transform: (code: string) => (root ? code : null)
	};
}
export class Counter {
	#n = 0;
	inc(): number {
		return ++this.#n;
	}
}
`
		),
		[]
	);
});

test("a component's own lets are its instance state, not a module singleton", () => {
	assert.deepEqual(
		reported(
			'packages/demo/src/Picker.svelte',
			`<script lang="ts">
	let picking = false;
	function start() {
		picking = true;
	}
	function stop() {
		picking = false;
	}
</script>

<button onclick={picking ? stop : start}>pick</button>
`
		),
		[]
	);
});

test('a name a function declares for itself is not the module let', () => {
	assert.deepEqual(
		reported(
			'packages/demo/src/shadow.ts',
			`let depth = 0;
export function enter(): void {
	depth++;
}
export function measure(depth: number): number {
	depth = depth * 2;
	return depth;
}
export function nested(): number {
	let depth = 1;
	depth += 1;
	return depth;
}
`
		),
		[]
	);
});

test('tests, fixtures and code outside package source are not read', () => {
	for (const rel of [
		'packages/demo/test/queries.test.ts',
		'packages/demo/src/fixtures/queries.ts',
		'packages/demo/src/queries.test.ts',
		'internal/sim/queries.ts',
		'apps/site/src/queries.ts'
	])
		assert.deepEqual(reported(rel, QUERIES), [], rel);
});
