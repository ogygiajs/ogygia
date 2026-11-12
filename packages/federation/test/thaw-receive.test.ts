// A peer's thaw notice arrives (`/og/thaw`) while this app's store is down: the evict fails. The
// peer must not answer `{ ok: true }` (the sender then stops sending), and must not remember the
// notice id (a retry with the same id would be `deduped` and never applied): it answers an error,
// and the sender's retry, the same notice, is applied (#287).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { federate } from '../src/federate.ts';
import { sign_headers, THAW_PATH } from '../src/wire.ts';
import { set_federation } from '../src/registry.ts';
import { serve_federation } from '../src/serve.ts';
import fed_server from '../src/server.ts';
// (core internals a test drives: a store's side of the shared `invalidate` hook)
import { register_hooks } from '../../core/src/plugin/hooks.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const cms_pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const cms_priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

/** The notice as the sender posts it (federate.ts post_thaw): signed with the sender's key. */
function thaw_event(notice: { id: string; hop: number; tags: string[] | 'all' }): RequestEvent {
	const url = new URL(THAW_PATH, 'http://shell.test');
	const bytes = new TextEncoder().encode(JSON.stringify({ ...notice, from: 'cms' }));
	const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	const headers = {
		'content-type': 'application/json',
		...sign_headers(cms_priv, 'POST', url, body as ArrayBuffer)
	};
	return {
		url,
		request: new Request(url, { method: 'POST', headers, body }),
		cookies: { get: () => undefined },
		locals: {}
	} as unknown as RequestEvent;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
});

describe('a thaw notice whose evict fails (#287)', () => {
	it('answers an error and keeps no id; the retry with the same id is applied', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const forwarded: string[] = [];
		vi.stubGlobal('fetch', async (u: URL) => {
			forwarded.push(String(u));
			return new Response('{}');
		});
		federate({
			name: 'shell',
			audience: 'shell.test',
			peers: { cms: { origin: 'http://cms.test', key: cms_pub } }
		});

		// the store's side of the hook: down for the first notice, up for the retry
		const applied: string[][] = [];
		let down = 1;
		const leave = register_hooks({
			invalidate(tags: string[]) {
				if (down-- > 0) throw new Error('store down');
				applied.push(tags);
			}
		});
		try {
			const notice = { id: 'n-287', hop: 0, tags: ['s:doc:1'] };
			const first = await serve_federation(thaw_event(notice));
			expect(first!.ok).toBe(false);
			expect(applied).toEqual([]);
			// (a notice this app did not apply is not passed on to its consumers either)
			await new Promise((r) => setTimeout(r, 0));
			expect(forwarded).toEqual([]);

			const retry = await serve_federation(thaw_event(notice));
			expect(retry!.ok).toBe(true);
			const answer = (await retry!.json()) as { ok: boolean; deduped?: boolean };
			expect(answer.deduped).toBeUndefined();
			expect(applied).toEqual([['r:cms:s:doc:1']]);

			// and once applied, the same id again is the dedupe it always was
			const again = (await (await serve_federation(thaw_event(notice)))!.json()) as {
				deduped?: boolean;
			};
			expect(again.deduped).toBe(true);
		} finally {
			leave();
		}
	});
});

describe('two copies of a notice at once (the sender tried again while the first applied)', () => {
	it('applies it once, and passes it on once', async () => {
		const forwarded: string[] = [];
		vi.stubGlobal('fetch', async (u: URL) => {
			forwarded.push(String(u));
			return new Response('{}');
		});
		federate({
			name: 'shell',
			audience: 'shell.test',
			peers: {
				cms: { origin: 'http://cms.test', key: cms_pub },
				site: { origin: 'http://site.test' }
			}
		});
		const applied: string[][] = [];
		const leave = register_hooks({
			async invalidate(tags: string[]) {
				await new Promise((r) => setTimeout(r, 20)); // a store's round trip
				applied.push(tags);
			}
		});
		try {
			const notice = { id: 'n-twice', hop: 0, tags: ['s:doc:2'] };
			const [a, b] = await Promise.all([
				serve_federation(thaw_event(notice)),
				serve_federation(thaw_event(notice))
			]);
			expect(a!.ok && b!.ok).toBe(true);
			expect(applied).toEqual([['r:cms:s:doc:2']]);
			await new Promise((r) => setTimeout(r, 10));
			// (passed on once to each consumer, the sender among them)
			expect(forwarded.filter((u) => u.startsWith('http://site.test'))).toHaveLength(1);
		} finally {
			leave();
		}
	});
});
