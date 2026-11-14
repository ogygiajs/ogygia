/**
 * One cold measurement in a fresh Node process, of a build of e2e/bench-app (ported from the
 * research lab's probe, internal/notes/design/server-chunks.md). Prints one JSON line. Times are ms
 * since the process started, so "ready" includes Node's own boot.
 *
 *   node probe.ts <build dir> cms     start the server, first request to a CMS page (/p/3), then 200
 *                                     warm requests over 50 pages
 *   node probe.ts <build dir> light   start the server, first request to a page with no regions
 *   node probe.ts <build dir> count   import the CMS page's module only, counting the files the ESM
 *                                     loader loads
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, mode] = process.argv.slice(2) as [string, string];
const PORT = process.env.PROBE_PORT ?? '3000';
const ms = (n: number): number => Math.round(n * 10) / 10;
const mb = (): number => Math.round(process.memoryUsage().rss / 1e5) / 10;
const out: Record<string, number | string> = { mode };

if (mode === 'count') {
	const { registerHooks } = await import('node:module');
	let files = 0;
	registerHooks({
		load(url, context, next) {
			if (url.startsWith('file:')) files++;
			return next(url, context);
		}
	});
	const pages = join(dir, 'server/chunks/entries/pages/p/_n_');
	const page = readdirSync(pages).find((f) => f.startsWith('_page.svelte') && f.endsWith('.js'));
	if (page === undefined) throw new Error(`no page module under ${pages}`);
	const t = performance.now();
	await import(pathToFileURL(join(pages, page)).href);
	out.import_ms = ms(performance.now() - t);
	out.files_loaded = files;
	console.log(JSON.stringify(out));
	process.exit(0);
}

process.env.PORT = PORT;
process.env.HOST = '127.0.0.1';
process.env.ORIGIN = `http://127.0.0.1:${PORT}`;
await import(pathToFileURL(join(dir, 'index.js')).href);
out.ready_ms = ms(performance.now());
out.rss_ready_mb = mb();

async function get(path: string): Promise<number> {
	const t = performance.now();
	const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
	const body = await res.text();
	if (res.status !== 200) throw new Error(`${path} answered ${res.status}: ${body.slice(0, 200)}`);
	return performance.now() - t;
}

out.first_ms = ms(await get(mode === 'light' ? '/about' : '/p/3'));
out.first_done_ms = ms(performance.now());
out.rss_first_mb = mb();
if (mode === 'cms') {
	const times: number[] = [];
	for (let i = 0; i < 200; i++) times.push(await get(`/p/${1 + (i % 50)}`));
	times.sort((a, b) => a - b);
	out.warm_p50_ms = ms(times[Math.floor(times.length * 0.5)]!);
	out.warm_p95_ms = ms(times[Math.floor(times.length * 0.95)]!);
}
console.log(JSON.stringify(out));
process.exit(0);
