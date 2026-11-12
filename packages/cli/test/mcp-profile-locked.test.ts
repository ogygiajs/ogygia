/**
 * `ogygia_profile` and a locked profiler (#869). A built app's profiler with a secret answers a
 * visitor without the key with a redirect to its login page. The tool must say "locked, ask for the
 * secret" (or "that key was rejected") before it records, not record into the login page.
 *
 * A real profiler (the devtools handle, as a built app runs it) behind a real HTTP server.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profiler } from '../../devtools/src/profiler/index.ts';
import { dispatch_tool } from '../src/mcp.ts';

vi.mock('../../devtools/src/profiler/env.ts', () => ({ detect_dev: () => false }));

const SECRET = 'a-profiler-secret-long-enough';
let server: Server;
let origin: string;

beforeEach(async () => {
	const handle = profiler({ secret: SECRET });
	server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const headers = new Headers();
		for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
		const request = new Request(url, { method: req.method, headers });
		const event = {
			url,
			request,
			route: { id: url.pathname.startsWith('/__profiler') ? null : '/[slug]' },
			cookies: {
				get: () => undefined,
				set() {},
				delete() {},
				getAll: () => [],
				serialize: () => ''
			},
			getClientAddress: () => '127.0.0.1',
			fetch: async () => new Response('<html><body>page</body></html>')
		} as unknown as RequestEvent;
		const answer = await handle({
			event,
			resolve: async () => new Response('<html><body>page</body></html>')
		});
		res.writeHead(answer.status, Object.fromEntries(answer.headers));
		res.end(Buffer.from(await answer.arrayBuffer()));
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
	await new Promise((r) => server.close(r));
});

const said = (out: { content: { text: string }[] }) => out.content.map((c) => c.text).join('\n');

describe('ogygia_profile on a locked profiler', () => {
	it('says the profiler is locked and asks for its secret when no key is given', async () => {
		const out = await dispatch_tool('ogygia_profile', { url: `${origin}/p`, runs: 1 });
		expect.soft(out.isError).toBe(true);
		expect(said(out)).toMatch(/is locked\. Ask the user for its secret/);
	});

	it('says the key was rejected when a wrong key is given', async () => {
		const out = await dispatch_tool('ogygia_profile', {
			url: `${origin}/p`,
			runs: 1,
			key: 'not-the-secret'
		});
		expect.soft(out.isError).toBe(true);
		expect(said(out)).toMatch(/rejected that `key`/);
	});
});
