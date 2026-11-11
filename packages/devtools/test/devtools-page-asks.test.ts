/**
 * The Page tab asks the dev server two things once and shows the finding once the answer is in: a
 * downloaded-again file's `Vary` header, and the dev server's pre-bundled packages. A request that
 * failed (the dev server restarting, a dropped connection) is asked again by a later read: one
 * failure does not hide the finding for the rest of the session. A real HTTP server answers, and
 * is down for the first ask.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { prebundled_packages, vary_of } from '../src/devtools/page.ts';
import { record_realm } from '../src/devtools/hook-record.ts';

let server: Server | null = null;
afterEach(async () => {
	server?.closeAllConnections();
	await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
	server = null;
});

/** A port nothing listens on yet (a connection to it is refused), and a server to start on it. */
async function later_server(
	answer: (path: string) => { headers?: Record<string, string>; body?: string }
) {
	const probe = createServer();
	await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
	const port = (probe.address() as AddressInfo).port;
	await new Promise<void>((r) => probe.close(() => r()));
	return {
		origin: `http://127.0.0.1:${port}`,
		start: async () => {
			server = createServer((req, res) => {
				const a = answer(req.url ?? '/');
				res.writeHead(200, { 'content-type': 'application/json', ...a.headers });
				res.end(a.body ?? '');
			});
			await new Promise<void>((r) => server!.listen(port, '127.0.0.1', r));
		}
	};
}

/** Reads `read` until it gives an answer (each read may start an ask), or `ms` pass. */
async function until<T>(read: () => T | null, ms = 3000): Promise<T | null> {
	const end = Date.now() + ms;
	for (;;) {
		const v = read();
		if (v !== null || Date.now() > end) return v;
		await new Promise((r) => setTimeout(r, 25));
	}
}

it("a file's Vary header is asked again after a failed ask", async () => {
	const s = await later_server(() => ({ headers: { vary: 'Origin' } }));
	const url = s.origin + '/font.woff2';
	expect(vary_of(url)).toBe(null); // asked: the connection is refused
	await new Promise((r) => setTimeout(r, 200));
	await s.start();
	expect(await until(() => vary_of(url))).toBe('Origin');
}, 10_000);

it("the dev server's pre-bundled packages are asked again after a failed ask", async () => {
	const s = await later_server(() => ({
		body: JSON.stringify({ optimized: { svelte: {}, '@scope/pkg/sub': {} } })
	}));
	const scripts = [s.origin + '/node_modules/.vite/deps/svelte.js?v=1'];
	// (the dev server's realm: only it has pre-bundled packages)
	record_realm({
		dev: true,
		lend: async () => ({ region_names: undefined, props_sidecar_of: () => null })
	});
	expect(prebundled_packages(scripts)).toBe(null); // asked: the connection is refused
	await new Promise((r) => setTimeout(r, 200));
	await s.start();
	expect(await until(() => prebundled_packages(scripts))).toEqual(['svelte', '@scope/pkg']);
}, 10_000);
