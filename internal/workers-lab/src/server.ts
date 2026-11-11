/**
 * The lab server. Env:
 *   PORT          (default 4777)
 *   LAB_THREADS   0 = every region on the main thread; n = a pool of n worker threads (default cores - 1)
 *   LAB_CLUSTER   n > 1 = n processes (node:cluster), each one thread inline: the usual way to use
 *                 every core today, and the baseline a pool has to beat on throughput
 *   LAB_SCALE     multiplies the page's work (default 1)
 * Routes: /page (the fixture page), /ping (a light request: how long the event loop makes it wait),
 * /stats (event-loop delay since the last /stats, pool counters).
 */
import { createServer } from 'node:http';
import cluster from 'node:cluster';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { scope } from '@ogygia/machine';
import { page_regions, stream_page } from './page.ts';
import { pool_stats, warm_threads, thread_count } from './thread.ts';

const PORT = Number(process.env.PORT ?? 4777);
const CLUSTER = Number(process.env.LAB_CLUSTER ?? 1);
const TICK_MS = 5;

if (CLUSTER > 1 && cluster.isPrimary) {
	for (let i = 0; i < CLUSTER; i++) cluster.fork();
	let up = 0;
	cluster.on('message', (_w, msg: { up?: boolean }) => {
		if (msg.up === true && ++up === CLUSTER) console.log('ready ' + PORT + ' cluster=' + CLUSTER);
	});
} else {
	const regions = page_regions(Number(process.env.LAB_SCALE ?? 1));
	const delay = monitorEventLoopDelay({ resolution: TICK_MS });
	delay.enable();
	const booted = performance.now();

	const server = createServer((req, res) => {
		if (req.url === '/ping') {
			res.end('ok');
			return;
		}
		if (req.url === '/stats') {
			// the histogram holds whole timer intervals: take the tick off, so 0 means "never blocked"
			const ms = (n: number): number => Math.max(0, Math.round((n - TICK_MS * 1e6) / 1e4) / 100);
			res.setHeader('content-type', 'application/json');
			res.end(
				JSON.stringify({
					pid: process.pid,
					threads: CLUSTER > 1 ? 0 : thread_count(),
					loop_delay_ms: {
						p50: ms(delay.percentile(50)),
						p99: ms(delay.percentile(99)),
						max: ms(delay.max)
					},
					rss_mb: Math.round(process.memoryUsage().rss / 1e6),
					pool: pool_stats
				})
			);
			delay.reset();
			return;
		}
		if (req.url !== '/page') {
			res.statusCode = 404;
			res.end();
			return;
		}
		// the request owns its renders: a client that hangs up drops the ones not started yet
		const request = scope();
		request.on(res, 'close', () => request.close());
		res.setHeader('content-type', 'text/html; charset=utf-8');
		stream_page(request, regions, (chunk) => res.write(chunk)).then(
			() => {
				res.end();
				request.close();
			},
			(error: unknown) => {
				console.error('[lab] page failed', error);
				res.end();
				request.close();
			}
		);
	});

	await warm_threads();
	server.listen(PORT, () => {
		const ready = Math.round(performance.now() - booted);
		if (cluster.isWorker) process.send?.({ up: true });
		else console.log('ready ' + PORT + ' threads=' + thread_count() + ' boot_ms=' + ready);
	});
}
