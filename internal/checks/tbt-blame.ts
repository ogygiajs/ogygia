// Apply Lighthouse's own attribution rule to a trace (./tbt-record.ts), and set it beside what
// really ran.
//  - Lighthouse (core/lib/tracehouse/main-thread-tasks.js + task-summary.js): a task's URLs come
//    from its own event (v8.compile / EvaluateScript / FunctionCall: args.data.url;
//    v8.compileModule: args.fileName; plus args.data.stackTrace urls), inherited down the tree; a
//    top-level task with no URL of its own gets every URL in its tree, in tree order. It is blamed
//    on the FIRST that is a JS resource.
//  - Real: the JS sampling profile (ProfileChunk) inside the task, by the URL of the sampled frame.
//
//   node internal/checks/tbt-blame.ts <prefix> [long-tasks-to-show=3]
import fs from 'node:fs';

type TraceEvent = {
	name: string;
	ph: string;
	pid: number;
	tid: number;
	ts: number;
	dur?: number;
	id?: string;
	// oxlint-disable-next-line typescript/no-explicit-any -- a trace event's args take a different shape per event name, read field by field below
	args?: Record<string, any>;
};
type Node = { e: TraceEvent & { dur: number }; children: Node[] };

const prefix = process.argv[2];
if (!prefix) {
	console.error('usage: node internal/checks/tbt-blame.ts <prefix> [long-tasks-to-show]');
	process.exit(1);
}
const trace = JSON.parse(fs.readFileSync(`${prefix}.trace.json`, 'utf8'));
const facts = JSON.parse(fs.readFileSync(`${prefix}.facts.json`, 'utf8'));
const events: TraceEvent[] = trace.traceEvents ?? trace;
const js_urls = new Set<string>(facts.scripts);
const short = (u: string) => {
	if (!u) return '(none)';
	try {
		const p = new URL(u).pathname;
		return p.includes('/immutable/') ? p.replace(/^.*\/immutable\//, '') : `${p} (document)`;
	} catch {
		return u;
	}
};

const parse = events.find(
	(e) => e.name === 'ParseHTML' && e.args?.beginData?.url?.startsWith('http')
);
if (!parse) throw new Error('no ParseHTML event: is this a page load trace?');
const PID = parse.pid;
const TID = parse.tid;
const main = events
	.filter(
		(e): e is Node['e'] => e.pid === PID && e.tid === TID && e.ph === 'X' && e.dur !== undefined
	)
	.sort((a, b) => a.ts - b.ts || b.dur - a.dur);

const roots: Node[] = [];
const stack: Node[] = [];
for (const e of main) {
	const n: Node = { e, children: [] };
	while (stack.length && stack[stack.length - 1].e.ts + stack[stack.length - 1].e.dur <= e.ts)
		stack.pop();
	if (stack.length) stack[stack.length - 1].children.push(n);
	else if (e.name === 'RunTask') roots.push(n);
	else continue;
	stack.push(n);
}

function own_urls(e: TraceEvent): string[] {
	const d = e.args?.data ?? {};
	const frames = (d.stackTrace ?? []).map((f: { url: string }) => f.url);
	switch (e.name) {
		case 'v8.compile':
		case 'EvaluateScript':
		case 'FunctionCall':
			return [d.url, ...frames].filter(Boolean);
		case 'v8.compileModule':
			return [e.args?.fileName, ...frames].filter(Boolean);
		default:
			return frames.filter(Boolean);
	}
}
function tree_urls(n: Node, out: string[] = []): string[] {
	for (const u of own_urls(n.e)) if (!out.includes(u)) out.push(u);
	for (const c of n.children) tree_urls(c, out);
	return out;
}
const blamed = (n: Node) => tree_urls(n).find((u) => js_urls.has(u));
function url_events(n: Node, out: TraceEvent[] = []): TraceEvent[] {
	if (own_urls(n.e).length || n.e.name === 'TimerFire') out.push(n.e);
	for (const c of n.children) url_events(c, out);
	return out;
}

const nodes = new Map<number, { url: string; fn: string; parent?: number }>();
const samples: Array<{ ts: number; id: number }> = [];
let t = 0;
const profile_id = events.find((e) => e.name === 'Profile' && e.pid === PID && e.tid === TID)?.id;
for (const e of events) {
	if (e.pid !== PID || e.id !== profile_id) continue;
	if (e.name === 'Profile') t = e.args!.data.startTime;
	if (e.name !== 'ProfileChunk') continue;
	const cp = e.args!.data.cpuProfile ?? {};
	for (const n of cp.nodes ?? [])
		nodes.set(n.id, { url: n.callFrame.url, fn: n.callFrame.functionName, parent: n.parent });
	const deltas: number[] = e.args!.data.timeDeltas ?? [];
	(cp.samples ?? []).forEach((id: number, i: number) => {
		t += deltas[i] ?? 0;
		samples.push({ ts: t, id });
	});
}
samples.sort((a, b) => a.ts - b.ts);

function sample_table(from: number, to: number) {
	const self = new Map<string, number>();
	const incl = new Map<string, number>();
	const fns = new Map<string, number>();
	for (let i = 0; i < samples.length - 1; i++) {
		const s = samples[i];
		if (s.ts < from || s.ts >= to) continue;
		const dt = (samples[i + 1].ts - s.ts) / 1000;
		const leaf = nodes.get(s.id);
		if (!leaf) continue;
		const lurl = leaf.url ? short(leaf.url) : `(${leaf.fn || 'native'})`;
		self.set(lurl, (self.get(lurl) ?? 0) + dt);
		const fkey = `${lurl} :: ${leaf.fn || '(anon)'}`;
		fns.set(fkey, (fns.get(fkey) ?? 0) + dt);
		const seen = new Set<string>();
		for (let id: number | undefined = s.id; id !== undefined; id = nodes.get(id)?.parent) {
			const n = nodes.get(id);
			if (!n?.url) continue;
			const u = short(n.url);
			if (seen.has(u)) continue;
			seen.add(u);
			incl.set(u, (incl.get(u) ?? 0) + dt);
		}
	}
	return { self, incl, fns };
}

const long = roots.filter((n) => n.e.dur > 50_000);
const tbt = long.reduce((s, n) => s + (n.e.dur / 1000 - 50), 0);
console.log(
	`trace: ${prefix}  CPU x${facts.rate}  long tasks: ${long.length}  blocking: ${tbt.toFixed(0)} ms`
);
console.log(`page: ${JSON.stringify(facts.page_facts)}`);
const by_blame = new Map<string, number>();
for (const n of long) {
	const b = short(blamed(n) ?? '');
	by_blame.set(b, (by_blame.get(b) ?? 0) + n.e.dur / 1000 - 50);
}
console.log('\nblocking time as Lighthouse would blame it:');
for (const [u, ms] of [...by_blame].sort((a, b) => b[1] - a[1]))
	console.log(`  ${ms.toFixed(0).padStart(7)} ms  ${u}`);

const t0 = main[0].ts;
const show = (n: Node, label: string) => {
	const from = n.e.ts;
	const to = n.e.ts + n.e.dur;
	console.log(
		`\n=== ${label}: ${(n.e.dur / 1000).toFixed(0)} ms at +${((from - t0) / 1000).toFixed(0)} ms; Lighthouse blames: ${short(blamed(n) ?? '')}`
	);
	const kids = new Map<string, number>();
	for (const c of n.children) kids.set(c.e.name, (kids.get(c.e.name) ?? 0) + c.e.dur / 1000);
	console.log(
		'  direct children:',
		[...kids]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 6)
			.map(([k, v]) => `${k} ${v.toFixed(0)}ms`)
			.join(', ')
	);
	console.log('  first URL-carrying events (time order):');
	for (const e of url_events(n).slice(0, 8))
		console.log(
			`    +${((e.ts - from) / 1000).toFixed(1)}ms ${e.name} ${e.args?.data?.functionName ?? ''} ${short(own_urls(e)[0] ?? '')} (${((e.dur ?? 0) / 1000).toFixed(1)} ms)`
		);
	const { self, incl, fns } = sample_table(from, to);
	console.log('  JS samples in the task, by file:  self ms | on-stack ms');
	const files = new Set([...self.keys(), ...incl.keys()]);
	for (const f of [...files].sort((a, b) => (self.get(b) ?? 0) - (self.get(a) ?? 0)).slice(0, 14))
		console.log(
			`    ${(self.get(f) ?? 0).toFixed(0).padStart(6)} | ${(incl.get(f) ?? 0).toFixed(0).padStart(6)}  ${f}`
		);
	console.log('  top functions (self):');
	for (const [f, ms] of [...fns].sort((a, b) => b[1] - a[1]).slice(0, 12))
		console.log(`    ${ms.toFixed(0).padStart(6)}  ${f}`);
};
const sorted = [...long].sort((a, b) => b.e.dur - a.e.dur);
sorted.slice(0, Number(process.argv[3] ?? 3)).forEach((n, i) => show(n, `long task #${i + 1}`));

const all = sample_table(-Infinity, Infinity);
console.log('\n=== whole recording, JS self ms by file (top 10)');
for (const [f, ms] of [...all.self].sort((a, b) => b[1] - a[1]).slice(0, 10))
	console.log(`  ${ms.toFixed(0).padStart(6)}  ${f}`);
console.log('=== whole recording, runtime functions (self ms)');
for (const [f, ms] of [...all.fns]
	.filter(([k]) => /og-runtime/.test(k))
	.sort((a, b) => b[1] - a[1])
	.slice(0, 12))
	console.log(`  ${ms.toFixed(1).padStart(6)}  ${f}`);
