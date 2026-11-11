/**
 * Idea 2's numbers (workers.md, "Browser probe"): builds src/browser/* for the browser (minified),
 * reports what the worker chunk weighs (Svelte's server runtime + one region's server code), then
 * opens the probe page in Chromium, Firefox and WebKit and prints its timings.
 *
 *   node browser-probe.ts
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build, type Plugin } from 'rolldown';
import { compile } from 'svelte/compiler';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';

const root = new URL('.', import.meta.url);
const out = new URL('dist-browser/', root);

const svelte_server: Plugin = {
	name: 'ogygia-lab:svelte-server',
	async load(id) {
		if (!id.endsWith('.svelte')) return null;
		const source = await readFile(id, 'utf8');
		const js = compile(source, {
			filename: id,
			generate: 'server',
			css: 'external',
			dev: false
		}).js;
		return { code: js.code, map: js.map, moduleType: 'js' };
	}
};

// one build per entry, so each file is whole (no chunk shared between them): its size is its cost
for (const name of ['probe-page', 'probe-worker'])
	await build({
		input: { [name]: new URL('src/browser/' + name + '.ts', root).pathname },
		platform: 'browser',
		plugins: [svelte_server],
		output: { dir: out.pathname, format: 'esm', minify: true, entryFileNames: '[name].js' },
		write: true
	});

const sizes: Record<string, string> = {};
for (const f of ['probe-worker.js', 'probe-page.js']) {
	const buf = await readFile(new URL(f, out));
	sizes[f] =
		(buf.length / 1024).toFixed(1) +
		' KB min, ' +
		(gzipSync(buf).length / 1024).toFixed(1) +
		' KB gzip, ' +
		(brotliCompressSync(buf).length / 1024).toFixed(1) +
		' KB br';
}
console.log(sizes);

const PAGE =
	'<!doctype html><meta charset="utf-8"><div id="host"></div><script type="module" src="/probe-page.js"></script>';
const server = createServer(async (req, res) => {
	if (req.url === '/') {
		res.setHeader('content-type', 'text/html');
		res.end(PAGE);
		return;
	}
	try {
		const body = await readFile(new URL('.' + req.url, out));
		res.setHeader('content-type', 'text/javascript');
		res.end(body);
	} catch {
		res.statusCode = 404; // ok: a missing file is a 404 (a source map the browser asks for)
		res.end();
	}
});
await new Promise<void>((r) => server.listen(4799, r));

const engines: [string, BrowserType][] = [
	['chromium', chromium],
	['firefox', firefox],
	['webkit', webkit]
];
for (const [name, engine] of engines) {
	let browser;
	try {
		browser = await engine.launch();
	} catch (e) {
		console.log(name + ': not installed (' + String(e).split('\n')[0] + ')');
		continue;
	}
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:4799/');
	const result = await page.evaluate(() => (globalThis as { __probe?: Promise<unknown> }).__probe);
	console.log(name + ' ' + JSON.stringify(result));
	await browser.close();
}
server.close();
