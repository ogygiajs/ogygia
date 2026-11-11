/**
 * The lab's benchmark (internal/notes/design/workers.md, "Prototype: numbers"). Run `node build.ts`
 * first. For each server shape (inline, pools, clusters) and each page scale, it:
 *   - boots the server and waits for it (a pool warms every worker before listening),
 *   - loads /page with autocannon at each concurrency for DURATION s (after a WARMUP s run),
 *   - meanwhile asks /ping at a steady 50/s on its own connection: how long a light request waits
 *     behind the heavy renders, which is what event-loop blocking costs other users,
 *   - reads the server's event-loop delay and its process tree's RSS.
 * Writes results.json next to this file and prints a Markdown table.
 *
 *   node bench.ts                          # the full matrix (about 12 minutes)
 *   node bench.ts --quick                  # 3 s runs, fewer shapes: a smoke test
 *   node bench.ts --only inline,pool-4     # some shapes
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import autocannon from 'autocannon';

const QUICK = process.argv.includes('--quick');
const ONLY = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]!.split(',')
	: null;
const DURATION = QUICK ? 3 : 10;
const WARMUP = QUICK ? 1 : 3;
const CORES = availableParallelism();
const CONCURRENCY = QUICK ? [1, 16] : [1, 4, 16, 64];

interface Shape {
	readonly label: string;
	readonly env: Record<string, string>;
}
const SHAPES: Shape[] = [
	{ label: 'inline', env: { LAB_THREADS: '0' } },
	{ label: 'pool-2', env: { LAB_THREADS: '2' } },
	{ label: 'pool-4', env: { LAB_THREADS: '4' } },
	{ label: 'pool-' + (CORES - 1), env: { LAB_THREADS: String(CORES - 1) } },
	{ label: 'cluster-4', env: { LAB_THREADS: '0', LAB_CLUSTER: '4' } },
	{ label: 'cluster-' + CORES, env: { LAB_THREADS: '0', LAB_CLUSTER: String(CORES) } }
].filter((s) =>
	ONLY ? ONLY.includes(s.label) : !QUICK || ['inline', 'pool-4', 'cluster-4'].includes(s.label)
);
const SCALES = QUICK ? [1] : [0.1, 1, 4];

let port = 4800;
const server_dir = new URL('.', import.meta.url).pathname;

async function boot(
	shape: Shape,
	scale: number
): Promise<{ child: ChildProcess; port: number; boot_ms: number }> {
	const p = port++;
	const started = performance.now();
	const child = spawn(process.execPath, ['dist/server.js'], {
		cwd: server_dir,
		env: { ...process.env, ...shape.env, PORT: String(p), LAB_SCALE: String(scale) },
		stdio: ['ignore', 'pipe', 'inherit']
	});
	await new Promise<void>((resolve, reject) => {
		child.once('exit', (code) => reject(new Error(shape.label + ' exited ' + code)));
		child.stdout!.on('data', (d: Buffer) => {
			if (d.toString().includes('ready')) resolve();
		});
	});
	return { child, port: p, boot_ms: Math.round(performance.now() - started) };
}

function rss_mb(pid: number): number {
	// the server and its cluster children (worker threads are inside their process)
	const pids = [String(pid)];
	try {
		pids.push(
			...execFileSync('pgrep', ['-P', String(pid)])
				.toString()
				.trim()
				.split('\n')
				.filter(Boolean)
		);
	} catch {
		// ok: pgrep exits 1 when there are no children (every shape but the clusters)
	}
	const out = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')]).toString();
	return Math.round(out.split('\n').reduce((s, l) => s + (Number(l.trim()) || 0), 0) / 1024);
}

interface Row {
	shape: string;
	scale: number;
	connections: number;
	rps: number;
	p50: number;
	p90: number;
	p97_5: number;
	p99: number;
	errors: number;
	ping_p50: number;
	ping_p99: number;
	ping_max: number;
	loop_p99: number;
	loop_max: number;
	rss_mb: number;
	boot_ms: number;
}

async function run(url: string, connections: number, duration: number): Promise<autocannon.Result> {
	return autocannon({ url, connections, duration, pipelining: 1 });
}

const rows: Row[] = [];
for (const scale of SCALES) {
	for (const shape of SHAPES) {
		const { child, port: p, boot_ms } = await boot(shape, scale);
		const base = 'http://127.0.0.1:' + p;
		try {
			await run(base + '/page', 4, WARMUP);
			for (const connections of CONCURRENCY) {
				await fetch(base + '/stats'); // resets the delay histogram
				const [page, ping] = await Promise.all([
					run(base + '/page', connections, DURATION),
					autocannon({ url: base + '/ping', connections: 1, overallRate: 50, duration: DURATION })
				]);
				const stats = (await (await fetch(base + '/stats')).json()) as {
					loop_delay_ms: { p99: number; max: number };
				};
				const row: Row = {
					shape: shape.label,
					scale,
					connections,
					rps: Math.round(page.requests.average * 10) / 10,
					p50: page.latency.p50,
					p90: page.latency.p90,
					p97_5: page.latency.p97_5,
					p99: page.latency.p99,
					errors: page.errors + page.non2xx + page.timeouts,
					ping_p50: ping.latency.p50,
					ping_p99: ping.latency.p99,
					ping_max: ping.latency.max,
					loop_p99: stats.loop_delay_ms.p99,
					loop_max: stats.loop_delay_ms.max,
					rss_mb: rss_mb(child.pid!),
					boot_ms
				};
				rows.push(row);
				console.log(JSON.stringify(row));
			}
		} finally {
			child.kill('SIGTERM');
			await new Promise((r) => child.once('exit', r));
		}
	}
}

const meta = {
	date: new Date().toISOString(),
	node: process.version,
	cores: CORES,
	duration_s: DURATION,
	note: 'cluster shapes: loop delay is one worker process of the cluster (whichever answered /stats)'
};
await writeFile(
	new URL(QUICK ? 'results-quick.json' : 'results.json', import.meta.url),
	JSON.stringify({ meta, rows }, null, '\t') + '\n'
);

const head =
	'| scale | shape | conns | req/s | p50 ms | p90 | p97.5 | p99 | /ping p50 | /ping p99 | loop p99 | loop max | RSS MB |';
console.log(
	'\n' +
		head +
		'\n|' +
		head
			.split('|')
			.slice(1, -1)
			.map(() => ' --- |')
			.join('')
);
for (const r of rows)
	console.log(
		`| ${r.scale} | ${r.shape} | ${r.connections} | ${r.rps} | ${r.p50} | ${r.p90} | ${r.p97_5} | ${r.p99} | ${r.ping_p50} | ${r.ping_p99} | ${r.loop_p99} | ${r.loop_max} | ${r.rss_mb} |`
	);
