/**
 * One cold measurement, in a fresh Node process (bench.ts runs it in a fresh container, after the
 * OS file cache was dropped). Prints one JSON line. Times are ms since the process started
 * (`performance.now()`), so "ready" includes Node's own boot.
 *
 *   node probe.ts <app dir> cms       start the server, first request to a CMS page (/p/3), then
 *                                     300 warm requests over 50 pages
 *   node probe.ts <app dir> light     start the server, first request to a page with no blocks
 *   node probe.ts <app dir> lazy      start the server, first request to the lazy CMS page
 *                                     (/lazy/3), then three pages that each need blocks not loaded
 *                                     yet, then (after loading every block) 300 warm requests
 *   node probe.ts <app dir> registry  only import the CMS page's module (it imports the registry)
 *   node probe.ts <app dir> count     registry, counting the files the ESM loader loads
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, mode] = process.argv.slice(2) as [string, string];
const mb = (): number => Math.round(process.memoryUsage().rss / 1e5) / 10;
const ms = (n: number): number => Math.round(n * 10) / 10;
const out: Record<string, number | string> = { mode };

function find_page_module(): string {
	const pages = join(dir, 'build/server/chunks/entries/pages/p/_n_');
	const file = readdirSync(pages).find((f) => f.startsWith('_page.svelte.js') && f.endsWith('.js'));
	if (file === undefined) throw new Error('no page module under ' + pages);
	return join(pages, file);
}

if (mode === 'registry' || mode === 'count') {
	let files = 0;
	let bytes_note = '';
	if (mode === 'count') {
		// (imported here: Bun runs this probe too, and has no registerHooks)
		const { registerHooks } = await import('node:module');
		registerHooks({
			load(url, context, next) {
				const result = next(url, context);
				if (url.startsWith('file:')) files++;
				return result;
			}
		});
		bytes_note = 'hooked';
	}
	const target = pathToFileURL(find_page_module()).href;
	out.rss_before_mb = mb();
	const t = performance.now();
	await import(target);
	out.registry_import_ms = ms(performance.now() - t);
	out.rss_after_mb = mb();
	if (mode === 'count') {
		out.files_loaded = files;
		out.note = bytes_note;
	}
	console.log(JSON.stringify(out));
	process.exit(0);
}

process.env.PORT = '3000';
process.env.HOST = '127.0.0.1';
process.env.ORIGIN = 'http://127.0.0.1:3000';
const t_import = performance.now();
await import(pathToFileURL(join(dir, 'build/index.js')).href);
out.ready_ms = ms(performance.now());
out.server_import_ms = ms(performance.now() - t_import);
out.rss_ready_mb = mb();

async function get(path: string): Promise<number> {
	const t = performance.now();
	const res = await fetch('http://127.0.0.1:3000' + path);
	const body = await res.text();
	if (res.status !== 200)
		throw new Error(path + ' answered ' + res.status + ': ' + body.slice(0, 200));
	return performance.now() - t;
}

const seen = new Set<string>();
let last_blocks: string[] = [];
async function get_blocks(path: string): Promise<number> {
	const t = performance.now();
	const res = await fetch('http://127.0.0.1:3000' + path);
	await res.text();
	if (res.status !== 200) throw new Error(path + ' answered ' + res.status);
	last_blocks = (res.headers.get('x-blocks') ?? '').split(',').filter(Boolean);
	return performance.now() - t;
}

const FIRST: Record<string, string> = { light: '/about', cms: '/p/3', lazy: '/lazy/3' };
out.first_ms = ms(mode === 'lazy' ? await get_blocks('/lazy/3') : await get(FIRST[mode]!));
out.first_done_ms = ms(performance.now());
out.rss_first_mb = mb();

if (mode === 'lazy') {
	for (const b of last_blocks) seen.add(b);
	// the next pages, each the first to need some blocks: how much does a block not loaded yet cost?
	const next: number[] = [];
	let new_blocks = 0;
	for (const n of [8, 13, 21]) {
		next.push(await get_blocks('/lazy/' + n));
		for (const b of last_blocks) if (!seen.has(b) && seen.add(b)) new_blocks++;
	}
	out.next_pages_ms = ms(next.reduce((a, b) => a + b, 0) / next.length);
	out.next_pages_new_blocks = new_blocks;
	for (let i = 1; i <= 50; i++) await get('/lazy/' + i); // load every block the warm loop uses
	const times: number[] = [];
	for (let i = 0; i < 300; i++) times.push(await get('/lazy/' + (1 + (i % 50))));
	times.sort((a, b) => a - b);
	out.warm_p50_ms = ms(times[Math.floor(times.length * 0.5)]!);
	out.warm_p95_ms = ms(times[Math.floor(times.length * 0.95)]!);
	out.rss_warm_mb = mb();
}

if (mode === 'cms') {
	const times: number[] = [];
	for (let i = 0; i < 300; i++) times.push(await get('/p/' + (1 + (i % 50))));
	times.sort((a, b) => a - b);
	out.warm_p50_ms = ms(times[Math.floor(times.length * 0.5)]!);
	out.warm_p95_ms = ms(times[Math.floor(times.length * 0.95)]!);
	out.rss_warm_mb = mb();
}
console.log(JSON.stringify(out));
process.exit(0);
