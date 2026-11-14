/**
 * CANARY (#1724): the reads of Kit's private request store ogygia keeps
 * (src/server/kit-request-store.ts), against every Kit the workspace installs. Every event read
 * goes through Kit's public `getRequestEvent()`; these are what it does not cover: the request's
 * `state.remote` (`data`, `implicit`) and running code inside a request. The reads are made by
 * `KitRequestStore` itself, inside a real Kit app's request (kit-app.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KitApp, type KitMode } from './kit-app.ts';
import { broke, KITS, type Internal } from './upstream.ts';

const STORE: Internal = {
	upstream: "SvelteKit's request store (`@sveltejs/kit/internal/server`)",
	used_by: [
		'packages/core/src/server/kit-request-store.ts',
		'packages/core/src/hooks.ts (the remote seed)',
		'packages/core/src/plugin/server.ts (app.keepAlive)',
		'packages/core/src/plugin/testing.ts (inRequest)'
	],
	issue: 1724
};

interface KitServer {
	try_get_request_store(): { event: unknown; state: unknown } | null;
	with_request_store<T>(store: { event: unknown; state: unknown } | null, fn: () => T): T;
	getRequestEvent(): unknown;
}

async function internal_server(root: string): Promise<Partial<KitServer>> {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
		exports: Record<string, { import?: string }>;
	};
	const entry = pkg.exports['./internal/server']?.import;
	expect(entry, broke(STORE, 'the package exports no `./internal/server` entry')).toBeTruthy();
	const mod = (await import(pathToFileURL(path.join(root, entry!)).href)) as Partial<KitServer>;
	await new Promise((r) => setTimeout(r, 0));
	return mod;
}

const MODES: readonly KitMode[] = ['dev', 'build'];

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

describe.each(Object.entries(KITS))("%s's request store", (_, root) => {
	it('exports the three functions ogygia calls', async () => {
		const kit = await internal_server(root);
		for (const fn of ['try_get_request_store', 'with_request_store', 'getRequestEvent'] as const)
			expect(typeof kit[fn], broke(STORE, `\`${fn}\` is no longer a function there`)).toBe(
				'function'
			);
	});

	it('hands back the store a request runs in, through an await, and null outside one', async () => {
		const kit = (await internal_server(root)) as KitServer;
		const store = { event: { url: new URL('https://app.test/') }, state: { remote: {} } };
		await kit.with_request_store(store, async () => {
			await new Promise((r) => setTimeout(r, 1));
			expect(kit.try_get_request_store(), broke(STORE, 'the store is not the one run with')).toBe(
				store
			);
			expect(kit.getRequestEvent(), broke(STORE, '`getRequestEvent()` is not `store.event`')).toBe(
				store.event
			);
		});
		expect(kit.try_get_request_store(), broke(STORE, 'a store outlives its request')).toBeNull();
	});

	describe.each(MODES)('in a real request, served from %s', (mode) => {
		const app = new KitApp(root, mode);
		beforeAll(() => app.start());
		afterAll(() => app.stop());

		it.each([
			['a csr=true page', '/', 'kit'],
			['a csr=false page', '/server', 'server']
		])(
			"hands KitRequestStore the request's state and event, and the remote query %s awaited",
			async (_, pathname, name) => {
				const { probe } = await app.probe(pathname);
				expect(probe.store, broke(STORE, 'the state read is not the running request store')).toBe(
					true
				);
				expect(probe.event, broke(STORE, 'the event read is not `getRequestEvent()`')).toBe(true);
				const payload = Buffer.from(JSON.stringify([name])).toString('base64url');
				expect(
					probe.remotes,
					broke(STORE, '`state.remote.implicit` no longer maps the awaited query to its results')
				).toEqual([
					{
						id: expect.stringMatching(/^\w+\/greet$/),
						type: 'query',
						payloads: [payload],
						memo: expect.not.stringMatching(/^undefined$/)
					}
				]);
			}
		);
	});
});
