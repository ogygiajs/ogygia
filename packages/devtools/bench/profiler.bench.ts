// The profiler's Node-side analysis, run per profiled request or per report: folding a CPU profile
// into the report's functions, lines and categories; decoding a server bundle's source map; the
// load-function source scans behind the "same work every request" and data-key findings; and the
// document diff between two renders.
//
// The devtools dock and the profiler's report UI run in the browser and wait for Heisenbench's browser
// coverage.
import { bench } from '@bench/heisenbench/bench';
import { analyze, decode_mappings, type CpuProfile } from '../src/profiler/analyze.ts';
import { doc_diff } from '../src/profiler/doc-diff.ts';
import { attribute_gc, type AllocSite } from '../src/profiler/gc.ts';
import { find_wait_patterns, type WaitCall } from '../src/profiler/patterns.ts';
import { constant_work, hoist_plan, key_sources } from '../src/profiler/source-scan.ts';
import { answer_keep, set_stack_capture } from '../src/profiler/net.ts';
import { PostgresStore } from '../src/profiler/storage/postgres.ts';
import { RedisStore } from '../src/profiler/storage/redis.ts';
import type { ProfilerRecord } from '../src/profiler/storage/index.ts';
import { DEVTOOLS_ERRORS, line } from '../src/messages/runtime.ts';

const APP = 'file:///srv/app/build/server/chunks';
const SVELTE = 'file:///srv/app/node_modules/svelte/src/internal/server';

/** A server render's CPU profile: a request handle over components, app code and dependencies. */
function render_profile(components: number, samples: number): CpuProfile {
	const nodes: CpuProfile['nodes'] = [];
	const frame = (functionName: string, url: string, lineNumber: number) => ({
		functionName,
		url,
		lineNumber,
		columnNumber: 4,
		scriptId: String(1 + (lineNumber % 40))
	});
	nodes.push({ id: 1, callFrame: frame('(root)', '', 0), children: [2, 3] });
	nodes.push({ id: 3, callFrame: frame('(garbage collector)', '', 0) });
	nodes.push({ id: 2, callFrame: frame('handle', `${APP}/hooks.server.js`, 12), children: [] });
	const leaves: number[] = [3];
	let id = 4;
	for (let c = 0; c < components; c++) {
		const comp = id++;
		nodes[2].children!.push(comp);
		const kids: number[] = [];
		nodes.push({
			id: comp,
			callFrame: frame(`Block${c % 40}`, `${APP}/Block${c % 40}.js`, 20 + c),
			children: kids
		});
		for (let k = 0; k < 4; k++) {
			const child = id++;
			kids.push(child);
			const url =
				k === 0
					? `${SVELTE}/index.js`
					: k === 1
						? `${APP}/format.js`
						: `file:///srv/app/node_modules/devalue/src/stringify.js`;
			nodes.push({
				id: child,
				callFrame: frame(
					k === 0 ? 'escape_html' : k === 1 ? `format_${c % 9}` : 'stringify',
					url,
					5 + k * 30
				),
				hitCount: 0,
				positionTicks: [{ line: 6 + k * 30, ticks: 3 }]
			});
			leaves.push(child);
		}
	}
	const sample_ids: number[] = [];
	const deltas: number[] = [];
	for (let s = 0; s < samples; s++) {
		sample_ids.push(leaves[(s * 7919) % leaves.length]);
		deltas.push(100 + (s % 7) * 10);
	}
	return { nodes, startTime: 0, endTime: samples * 130, samples: sample_ids, timeDeltas: deltas };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(n: number): string {
	let v = n < 0 ? (-n << 1) | 1 : n << 1;
	let out = '';
	do {
		let digit = v & 31;
		v >>>= 5;
		if (v > 0) digit |= 32;
		out += B64[digit];
	} while (v > 0);
	return out;
}

/** The `mappings` of a bundled server chunk: `lines` lines of ~10 segments over 30 sources. */
function mappings(lines: number): string {
	const out: string[] = [];
	for (let l = 0; l < lines; l++) {
		const segs: string[] = [];
		for (let s = 0; s < 10; s++) {
			segs.push(
				vlq(s === 0 ? 0 : 6) +
					vlq(s === 0 && l % 25 === 0 ? 1 : 0) +
					vlq(s === 0 ? 1 : 0) +
					vlq(s === 0 ? -54 : 6)
			);
		}
		out.push(segs.join(','));
	}
	return out.join(';');
}

/** A `+page.server.ts` with a load that does the same work every request, and data keys. */
function load_module(consts: number): string {
	const lines = [
		`import type { PageServerLoad } from './$types';`,
		`import { PRODUCTS, BRANDS, validateAll, attachBrands } from '$lib/catalog';`,
		'',
		'export const load: PageServerLoad = async ({ url, fetch, locals }) => {',
		'\tconst origin = url.origin;'
	];
	for (let i = 0; i < consts; i++) {
		lines.push(
			i % 3 === 0
				? `\tconst valid${i} = validateAll(PRODUCTS.slice(${i}));`
				: i % 3 === 1
					? `\tconst joined${i} = attachBrands(valid${i - 1}, BRANDS);`
					: `\tconst user${i} = await (await fetch(origin + '/api/user/${i}')).json();`
		);
	}
	const keys = Array.from(
		{ length: consts },
		(_, i) => `\t\tkey${i}: ${i % 3 === 2 ? `user${i}` : `joined${i - (i % 3 === 0 ? -1 : 0)}`},`
	);
	lines.push('\treturn {', ...keys, '\t\tlocale: locals.locale', '\t};', '};');
	return `${lines.join('\n')}\n`;
}

function render_html(rows: number, changed: number): string {
	const out = ['<!doctype html><html><head><title>t</title></head><body>'];
	for (let i = 0; i < rows; i++) {
		const v = i < changed ? `v2-${i}` : `v1-${i}`;
		out.push(
			`<ogygia-region entry="/_app/ogygia/og-region.${i % 20}.js" data-og-fp="fp${i}"><li data-v="${v}">Row ${i} ${v}</li></ogygia-region>`,
			`<script type="application/ogygia-props" data-ogygia-props="fp${i}">{"row":${i},"v":"${v}"}</script>`
		);
	}
	out.push('</body></html>');
	return out.join('');
}

bench(
	'analyze: fold a render’s CPU profile into the report',
	({ profile }) => analyze(profile).functions.length,
	{
		setup: () => ({ profile: render_profile(60, 4000) }),
		scale: (_ctx, k) => ({ profile: render_profile(60 * k, 4000 * k) })
	}
);

bench('decode_mappings: a server chunk’s source map', ({ m }) => decode_mappings(m).length, {
	setup: () => ({ m: mappings(2000) }),
	scale: (_ctx, k) => ({ m: mappings(2000 * k) })
});

bench(
	'source scans: constant work and data keys of a load function',
	({ source }) => constant_work(source).length + (key_sources(source)?.size ?? 0),
	{ setup: () => ({ source: load_module(60) }) }
);

bench(
	'doc_diff: two renders of a page that differ in a few rows',
	({ a, b }) => doc_diff(a, b)?.groups.length ?? 0,
	{ setup: () => ({ a: render_html(400, 0), b: render_html(400, 12) }) }
);

/** A profiled window of `pauses` collections, one every 10 ms, over the CPU timeline (four segments
 *  a pause: the app's code, a component, idle time and the collector) and `reads` allocation reads. */
function gc_window(pauses: number, reads = 20): Parameters<typeof attribute_gc>[0] {
	const window_ms = pauses * 10;
	const dict: Record<string, AllocSite> = {};
	for (let j = 0; j < 12; j++)
		dict[`s${j}`] = {
			key: `s${j}`,
			name: `make${j}`,
			url: 'file:///srv/app/src/lib/data.ts',
			line: j + 1,
			category: j % 3 ? 'app' : 'component',
			component: j % 3 ? null : `Card${j}`
		};
	const slices = Array.from({ length: reads }, (_, i) => ({
		t0: (i * window_ms) / reads,
		t1: ((i + 1) * window_ms) / reads,
		bytes: Object.fromEntries(Object.keys(dict).map((k, j) => [k, 1000 * (i + j + 1)]))
	}));
	const events = Array.from({ length: pauses }, (_, i) => ({
		t: i * 10 + 7,
		ms: 1 + (i % 4),
		kind: i % 10 === 9 ? ('major' as const) : ('minor' as const),
		flags: 0
	}));
	const categories = ['app', 'component', 'idle', 'gc'];
	const running = Array.from({ length: pauses * 4 }, (_, i) => ({
		t0: i * 2.5,
		t1: i * 2.5 + 2,
		label: `fn${i % 50}`,
		category: categories[i % 4],
		file: 'src/lib/data.ts'
	}));
	return { slices, events, dict, window_ms, running };
}

// Growth: linear in the window's pauses and segments. It was quadratic while each pause looked
// through every segment of the timeline for what was running.
bench(
	'attribute_gc: what each pause of a window was charged to, as the window grows',
	(input) => attribute_gc(input).pauses.length,
	{
		setup: () => gc_window(50),
		scale: (_ctx, k) => gc_window(50 * k)
	}
);

/** …with the reads handed over newest first (each pause's reads are put back in read order) */
const newest_first = (w: Parameters<typeof attribute_gc>[0]) => ({
	...w,
	slices: [...w.slices].reverse()
});

// Growth: n log n in the window's pauses and reads (one read every 20 ms, as the recorder reads).
// It was quadratic while each pause looked through every read for the allocations before it.
bench(
	'attribute_gc: what each pause was charged to, as the window and its allocation reads grow',
	(input) => attribute_gc(input).pauses.length,
	{
		setup: () => newest_first(gc_window(50, 25)),
		scale: (_ctx, k) => newest_first(gc_window(50 * k, 25 * k))
	}
);

/** One helper line called in `chains` chains of awaits in a row (`for (…) await getItem(id)`), each
 *  chain then a batch of three calls run together (a `Promise.all`), across two pages. */
function wait_calls(chains: number): WaitCall[] {
	const at = { path: '/srv/app/src/lib/api.ts', line: 12 };
	const calls: WaitCall[] = [];
	let t = 0;
	for (let c = 0; c < chains; c++) {
		const scope = c % 2 ? '/products' : '/cart';
		const outer = { path: `/srv/app/src/routes${scope}/+page.server.ts`, line: 4 + (c % 3) };
		for (let i = 0; i < 4; i++, t += 31)
			calls.push({ start: t, ms: 30, target: 'GET api/items/:id', at, outer, scope });
		for (let i = 0; i < 3; i++)
			calls.push({ start: t, ms: 25, target: 'GET api/stock/:id', at, outer, scope });
		t += 40;
	}
	return calls;
}

// Growth: n log n in the calls (one sort per helper line). It was quadratic while each call looked
// through every other call of its line for one that started with it.
bench(
	'find_wait_patterns: the waits in a row of one helper line, as the calls grow',
	({ calls }) => find_wait_patterns({ calls }).length,
	{
		setup: () => ({ calls: wait_calls(10) }),
		scale: (_ctx, k) => ({ calls: wait_calls(10 * k) })
	}
);

/** A `+page.server.ts` with `helpers` pairs of helpers (one formats with the other, every fifth of
 *  those reads the clock) and a load that runs each pair on the module's products. */
function helper_module(helpers: number): string {
	const lines = [
		`import type { PageServerLoad } from './$types';`,
		`import { PRODUCTS } from '$lib/catalog';`,
		''
	];
	for (let i = 0; i < helpers; i++)
		lines.push(
			`function list${i}(items) {`,
			`\treturn items.map(card${i});`,
			'}',
			`const card${i} = (p) => ({ ...p, slot: ${i}${i % 5 === 0 ? ', at: Date.now()' : ''} });`
		);
	lines.push('', 'export const load: PageServerLoad = async ({ url }) => {');
	for (let i = 0; i < helpers; i++) lines.push(`\tconst cards${i} = list${i}(PRODUCTS);`);
	lines.push(
		'\treturn {',
		...Array.from({ length: helpers }, (_, i) => `\t\tcards${i},`),
		"\t\tq: url.searchParams.get('q')",
		'\t};',
		'};'
	);
	return `${lines.join('\n')}\n`;
}

// Growth: linear in the module's helpers. It was quadratic while each token of a helper's lines
// looked through the list of every helper, again on every pass.
bench(
	'hoist_plan: the constant lines of a load to move to the top, as its helpers grow',
	({ source }) => hoist_plan(source)?.stmts.length ?? 0,
	{
		setup: () => ({ source: helper_module(10) }),
		scale: (_ctx, k) => ({ source: helper_module(10 * k) })
	}
);

// Recordings that overlap (two profilers in one dev process) each turn their own asks on and off:
// every on is matched by its off, so the switches end where they started.
bench(
	'the network layer’s switches: overlapping recordings turn their own stacks and kept answers on and off',
	({ n }) => {
		const owners = Array.from({ length: n }, () => ({}));
		for (const o of owners) {
			set_stack_capture(o, true);
			answer_keep.keep(o, true);
		}
		let off = 0;
		for (const o of owners) {
			answer_keep.keep(o, false);
			set_stack_capture(o, false);
			answer_keep.drop(o);
			off++;
		}
		return off;
	},
	{ setup: () => ({ n: 50 }), scale: (_ctx, k) => ({ n: 50 * k }) }
);

/** A Postgres client that answers every query with no rows. */
function pg_client() {
	return { query: async (_text: string) => ({ rows: [] as Record<string, unknown>[] }) };
}

/** A node-redis client over two in-memory maps. */
function redis_client() {
	const kv = new Map<string, string>();
	const z = new Map<string, Map<string, number>>();
	const zset = (k: string) => z.get(k) ?? z.set(k, new Map()).get(k)!;
	return {
		set: async (k: string, v: string) => void kv.set(k, v),
		get: async (k: string) => kv.get(k) ?? null,
		del: async (k: string | string[]) => {
			for (const x of Array.isArray(k) ? k : [k]) kv.delete(x);
		},
		zAdd: async (k: string, m: { score: number; value: string }) =>
			void zset(k).set(m.value, m.score),
		zRem: async (k: string, m: string | string[]) => {
			for (const x of Array.isArray(m) ? m : [m]) zset(k).delete(x);
		},
		zRange: async (k: string, a: number, b: number, o?: { REV: true }) => {
			const members = [...zset(k)].sort((x, y) => x[1] - y[1]).map(([m]) => m);
			if (o?.REV) members.reverse();
			const end = b < 0 ? members.length + b : b;
			return members.slice(Math.max(0, a), Math.max(0, end + 1));
		},
		zCard: async (k: string) => zset(k).size,
		quit: async () => undefined
	};
}

const report = (i: number): ProfilerRecord => ({
	id: `r${i}`,
	created: i,
	page: `/p${i % 5}`,
	trigger: 'page',
	label: `/p${i % 5}`,
	median: i,
	dump: '{}'
});

// Each store connects and sets up once (two first calls share it), then writes and reads reports.
bench(
	'the Postgres and Redis stores over in-memory clients: one setup, then reports written and listed',
	async ({ n }) => {
		const pg = new PostgresStore(pg_client());
		const redis = new RedisStore(redis_client());
		await Promise.all([pg.init(), pg.init(), redis.init(), redis.init()]);
		for (let i = 0; i < n; i++) {
			await pg.putReport(report(i));
			await redis.putReport(report(i));
		}
		const listed = (await pg.listReports(10)).length + (await redis.listReports(10)).length;
		await pg.close();
		await redis.close();
		return listed;
	},
	{ setup: () => ({ n: 20 }), scale: (_ctx, k) => ({ n: 20 * k }) }
);

// The message the dock's launcher logs when its code fails to download: its line, and its page.
bench(
	'the dock’s failed-download message: its line and its page',
	() => {
		const said = DEVTOOLS_ERRORS.devtools_dock_load_failed;
		return line('devtools_dock_load_failed').length + said.text().length + said.details().length;
	},
	{ setup: () => ({}) }
);
