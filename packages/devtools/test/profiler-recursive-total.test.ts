// #602: a function on one stack at several depths (f calls f calls f) ran for the sample's time
// once. Every view that shows it as ONE function shows that time once, never once per depth.
import { describe, expect, it } from 'vitest';
import { analyze, type CpuProfile, type PathNode } from '../src/profiler/analyze.ts';
import { range_hot } from '../src/profiler/stacks.ts';

const frame = (functionName: string, url: string, lineNumber = 1) => ({
	functionName,
	url,
	lineNumber,
	columnNumber: 0,
	scriptId: '1'
});

/** one sample of 10 ms: (root) → `outer` → `inner` → `outer` → `inner` → `outer` → leaf, with the
 *  outermost call of `name` first; `f.ts` holds every function, `Tree.svelte` the component */
function recursive(outer: { name: string; url: string }, inner?: { name: string; url: string }) {
	const chain = inner ? [outer, inner, outer, inner, outer] : [outer, outer, outer];
	const nodes: CpuProfile['nodes'] = [{ id: 1, callFrame: frame('(root)', ''), children: [2] }];
	chain.forEach((c, i) =>
		nodes.push({ id: i + 2, callFrame: frame(c.name, c.url, 3), children: [i + 3] })
	);
	const leaf = chain.length + 2;
	nodes.push({ id: leaf, callFrame: frame('leaf', 'file:///app/src/lib/leaf.ts', 7) });
	return {
		nodes,
		startTime: 0,
		endTime: 10_000,
		samples: [leaf],
		timeDeltas: [10_000]
	} satisfies CpuProfile;
}

const F = { name: 'f', url: 'file:///app/src/lib/f.ts' };
const G = { name: 'g', url: 'file:///app/src/lib/g.ts' };
const TREE = { name: 'Tree', url: 'file:///app/src/lib/Tree.svelte' };

const run = (p: CpuProfile) =>
	analyze(p, undefined, undefined, {
		perf_start: 0,
		window: { start: 0, end: 10 },
		calls: []
	});

/** every number a path tree shows, for the node of `key` */
function tree_ms(n: PathNode, key: string, out: number[] = []): number[] {
	if (n.key === key) out.push(n.ms);
	for (const c of n.children) tree_ms(c, key, out);
	return out;
}

/** every view of the analysis that names `key` as one function: none may show more than `cpu` */
function expect_once(a: ReturnType<typeof run>, key: string, cpu: number) {
	const fn = a.functions.find((x) => x.key === key)!;
	expect(fn, `${key} in functions`).toBeDefined();
	expect(fn.total_ms).toBe(cpu);
	// the call paths into it: one outermost call, so one path of the whole time
	expect(fn.stacks?.length).toBe(1);
	expect(fn.stacks![0].ms).toBe(cpu);
	// what it called: never more than its own total, never more than all of it
	expect(fn.callees?.length).toBeGreaterThan(0);
	const callees_ms = fn.callees!.reduce((s, x) => s + x.ms, 0);
	expect(callees_ms).toBeLessThanOrEqual(fn.total_ms);
	for (const c of fn.callees!) expect(c.share).toBeLessThanOrEqual(1);
	// the path groups that it owns, or that it sits in
	for (const g of a.paths) {
		if (g.owner.key === key) expect(g.owner.total_ms).toBeLessThanOrEqual(cpu);
		expect(g.ms).toBeLessThanOrEqual(cpu);
		for (const n of tree_ms(g.tree, key)) expect(n).toBeLessThanOrEqual(cpu);
	}
	return fn;
}

describe('a recursive function in one 10 ms sample', () => {
	it('range_hot gives each of its three frames the 10 ms, and the range 10 ms of cpu', () => {
		const a = run(recursive(F));
		const r = range_hot(a.stacks!, 0, 10);
		expect(r.cpu_ms).toBe(10);
		const fs = r.total.filter((x) => x.name === 'f');
		expect(fs.map((x) => x.total_ms)).toEqual([10, 10, 10]);
		for (const row of r.total) expect(row.total_ms).toBeLessThanOrEqual(r.cpu_ms);
	});

	it('f calls f calls f: every view that groups by function shows f at 10 ms, never 30', () => {
		const a = run(recursive(F));
		const f = expect_once(a, a.functions.find((x) => x.name === 'f')!.key, 10);
		expect(f.self_ms).toBe(0);
		expect(a.busy_ms).toBe(10);
	});

	it('f calls g calls f (mutual recursion): f and g each show 10 ms', () => {
		const a = run(recursive(F, G));
		expect_once(a, a.functions.find((x) => x.name === 'f')!.key, 10);
		expect_once(a, a.functions.find((x) => x.name === 'g')!.key, 10);
	});

	it('a recursive caller of two hot functions: its path group shows it at 20 ms over two 10 ms samples, never 60', () => {
		const f = (id: number, children: number[]) => ({
			id,
			callFrame: frame('f', F.url, 3),
			children
		});
		const p: CpuProfile = {
			nodes: [
				{ id: 1, callFrame: frame('(root)', ''), children: [2] },
				f(2, [3]),
				f(3, [4]),
				f(4, [5, 6]),
				{ id: 5, callFrame: frame('a', 'file:///app/src/lib/a.ts', 3) },
				{ id: 6, callFrame: frame('b', 'file:///app/src/lib/b.ts', 3) }
			],
			startTime: 0,
			endTime: 20_000,
			samples: [5, 6],
			timeDeltas: [10_000, 10_000]
		};
		const a = analyze(p, undefined, undefined, {
			perf_start: 0,
			window: { start: 0, end: 20 },
			calls: []
		});
		const key = a.functions.find((x) => x.name === 'f')!.key;
		const group = a.paths.find((g) => g.owner.key === key)!;
		expect(group, 'f owns a path group').toBeDefined();
		expect(group.owner.total_ms).toBe(20);
		expect(group.ms).toBe(20);
		expect(tree_ms(group.tree, key)).toEqual([20]);
		expect_once(a, key, 20);
	});

	it('a component that renders itself: the component shows 10 ms in every component view', () => {
		const a = run(recursive(TREE));
		const tree = a.components.find((c) => c.name === 'Tree')!;
		expect(tree, 'Tree in components').toBeDefined();
		expect_once(a, tree.key, 10);
		expect(tree.total_ms).toBe(10);
		expect((tree.markup_ms ?? 0) + (tree.logic_ms ?? 0)).toBeLessThanOrEqual(10);
		for (const ms of tree.runs_ms ?? []) expect(ms).toBeLessThanOrEqual(10);
		for (const ms of Object.values(a.owner_runs_ms ?? {}).flat())
			expect(ms).toBeLessThanOrEqual(10);
		const r = range_hot(a.stacks!, 0, 10);
		for (const row of r.components) expect(row.total_ms).toBeLessThanOrEqual(r.cpu_ms);
	});
});
