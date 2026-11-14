/**
 * The islands' JS weight is measured once per process per URL. A file the static host could not
 * answer just now (a 5xx, a timeout) is not that for good: the next report weighs it again. Two
 * reports at once weigh a file once. A real HTTP server answers.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { url_weights, weigh_urls } from '../src/profiler/index.ts';

let server: Server | null = null;
afterEach(async () => {
	server?.closeAllConnections();
	await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
	server = null;
});

/** A static host: `answer` says what each GET of a path gets; `hits` counts them. */
async function host(answer: (path: string, hit: number) => number | 'hang') {
	const hits = new Map<string, number>();
	server = createServer((req, res) => {
		const path = req.url ?? '/';
		const hit = (hits.get(path) ?? 0) + 1;
		hits.set(path, hit);
		const a = answer(path, hit);
		if (a === 'hang') return; // never answers (the client gives up)
		const body = a === 200 ? 'export default 1;' : 'busy';
		res.writeHead(a, { 'content-type': 'text/javascript', 'content-length': body.length });
		res.end(body);
	});
	await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
	const origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
	return { url: (p: string) => origin + p, hits };
}

it('a 5xx is weighed again by the next report', async () => {
	const h = await host((_, hit) => (hit === 1 ? 503 : 200));
	const weights = url_weights();
	const u = h.url('/a.js');
	expect(await weigh_urls([u], (x) => fetch(x), weights)).toEqual({});
	expect(await weigh_urls([u], (x) => fetch(x), weights)).toEqual({ [u]: 17 });
	expect(h.hits.get('/a.js')).toBe(2);
});

it('a timeout is weighed again by the next report', async () => {
	const h = await host((_, hit) => (hit === 1 ? 'hang' : 200));
	const weights = url_weights();
	const u = h.url('/b.js');
	expect(await weigh_urls([u], (x) => fetch(x), weights, 300)).toEqual({});
	expect(await weigh_urls([u], (x) => fetch(x), weights, 2000)).toEqual({ [u]: 17 });
}, 10_000);

it('a 404 is that for good: not asked again', async () => {
	const h = await host(() => 404);
	const weights = url_weights();
	const u = h.url('/gone.js');
	await weigh_urls([u], (x) => fetch(x), weights);
	await weigh_urls([u], (x) => fetch(x), weights);
	expect(h.hits.get('/gone.js')).toBe(1);
});

it('two reports at once weigh a file once', async () => {
	const h = await host(() => 200);
	const weights = url_weights();
	const u = h.url('/c.js');
	const [a, b] = await Promise.all([
		weigh_urls([u], (x) => fetch(x), weights),
		weigh_urls([u], (x) => fetch(x), weights)
	]);
	expect(a).toEqual({ [u]: 17 });
	expect(b).toEqual({ [u]: 17 });
	expect(h.hits.get('/c.js')).toBe(1);
});
