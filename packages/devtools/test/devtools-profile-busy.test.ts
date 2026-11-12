/**
 * The dock's "profile this page" waits while the server's recorder is busy (a 409): it asks again
 * when the answer's `Retry-After` says (else every 2 s), and it stops asking once its owner ends
 * (the dock closed, the tab left). A real HTTP server answers.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { scope } from '@ogygia/machine';
import { run_profile } from '../src/devtools/profile-store.ts';

let server: Server | null = null;
afterEach(async () => {
	server?.closeAllConnections();
	await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
	server = null;
});

/** A profiler that is busy for every ask: `retry_after` (s) on its 409, and when each ask came. */
async function busy_profiler(retry_after?: number) {
	const at: number[] = [];
	server = createServer((_req, res) => {
		at.push(Date.now());
		res.writeHead(409, {
			'content-type': 'application/json',
			...(retry_after === undefined ? {} : { 'retry-after': String(retry_after) })
		});
		res.end('{"error":"busy"}');
	});
	await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
	return { base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/__profiler`, at };
}

it('stops asking once its owner ends', async () => {
	const p = await busy_profiler();
	const owner = scope();
	const done = run_profile('/x', 1, p.base, owner).catch((e: unknown) => e);
	await new Promise((r) => setTimeout(r, 300));
	owner.close();
	await new Promise((r) => setTimeout(r, 2500)); // past the next 2 s wait
	expect(p.at).toHaveLength(1);
	expect(await done).toBe(null);
}, 10_000);

it("asks again when the 409's Retry-After says", async () => {
	const p = await busy_profiler(1);
	const owner = scope();
	void run_profile('/x', 1, p.base, owner).catch(() => {});
	await new Promise((r) => setTimeout(r, 1500));
	owner.close();
	expect(p.at.length).toBeGreaterThanOrEqual(2);
	expect(p.at[1] - p.at[0]).toBeLessThan(1400);
}, 10_000);

it('a Retry-After past any timer waits, and ends with its owner, never failing (#1096)', async () => {
	const p = await busy_profiler(99_999_999); // ~3 years
	const owner = scope();
	const done = run_profile('/x', 1, p.base, owner).catch((e: unknown) => e);
	await new Promise((r) => setTimeout(r, 300));
	owner.close();
	expect(await done).toBe(null);
	expect(p.at).toHaveLength(1);
}, 10_000);
