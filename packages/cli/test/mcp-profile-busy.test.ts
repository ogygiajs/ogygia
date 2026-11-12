/**
 * `ogygia_profile` and a recording someone else holds (#290). The profiler answers a page profile
 * with 409 while another recording holds its recorder. The tool took every 409 for a stuck
 * recording: it called `/reset`, which takes the recorder from whoever holds it, and recorded again.
 * A user's live window (or an e2e `record({ server: true })`) lost its recording.
 *
 * A real profiler (the devtools handle) behind a real HTTP server; the holder is a window started
 * over HTTP, as a person or a test starts one.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profiler } from '../../devtools/src/profiler/index.ts';
import { dispatch_tool } from '../src/mcp.ts';

vi.mock('../../devtools/src/profiler/env.ts', () => ({ detect_dev: () => true }));

let server: Server;
let origin: string;

beforeEach(async () => {
	const handle = profiler({});
	server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const headers = new Headers();
		for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
		const request = new Request(url, {
			method: req.method,
			headers,
			body: chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined
		});
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

const start_window = async () => {
	const res = await fetch(`${origin}/__profiler/window/start`, { method: 'POST' });
	expect(res.status).toBe(200);
	return ((await res.json()) as { id: string }).id;
};
const stop_window = (id: string) =>
	fetch(`${origin}/__profiler/window/stop`, { method: 'POST', headers: { 'x-og-window': id } });

describe('ogygia_profile while another recording holds the profiler', () => {
	it('leaves a live window alone and says the profiler is busy', async () => {
		const id = await start_window();
		const out = await dispatch_tool('ogygia_profile', { url: `${origin}/p`, runs: 1 });
		const said = out.content.map((c) => c.text).join('\n');
		expect.soft(out.isError).toBe(true);
		expect.soft(said).toMatch(/busy/i);
		// the holder still has its window: its stop makes its own report, sampled here
		const stopped = await stop_window(id);
		const report = (await stopped.json()) as { id?: string | null; kind?: string };
		expect(stopped.status).toBe(200);
		expect(report.kind).toBe('window');
		expect(report.id).not.toBeNull();
	}, 30_000);

	it('clears a stale holder with a reset, and records once more', async () => {
		// a profiler whose recorder a dead page recording still holds, past its cap
		const asked: string[] = [];
		const stale = createServer((req, res) => {
			const path = new URL(req.url ?? '/', 'http://localhost').pathname;
			asked.push(path);
			if (path === '/__profiler/page' && !asked.includes('/__profiler/reset')) {
				res.writeHead(409, { 'content-type': 'application/json' });
				res.end(
					JSON.stringify({
						busy: true,
						message: 'busy',
						holder: { kind: 'cut', age_ms: 40_000, stale: true }
					})
				);
			} else if (path === '/__profiler/reset') {
				res.writeHead(303, { location: '/__profiler' });
				res.end();
			} else {
				res.writeHead(200, { 'content-type': 'text/plain' });
				res.end('profiler');
			}
		});
		await new Promise<void>((r) => stale.listen(0, '127.0.0.1', r));
		try {
			const at = `http://127.0.0.1:${(stale.address() as AddressInfo).port}`;
			await dispatch_tool('ogygia_profile', { url: `${at}/p`, runs: 1 });
			expect(asked.filter((p) => p !== '/__profiler')).toEqual([
				'/__profiler/page',
				'/__profiler/reset',
				'/__profiler/page'
			]);
		} finally {
			await new Promise((r) => stale.close(r));
		}
	});
});
