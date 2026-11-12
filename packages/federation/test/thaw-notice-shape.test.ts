// A thaw notice a known peer signs is the notice's shape or refused (#988): `id` a string, `hop` a
// whole number from 0, `tags` `'all'` or strings. One that is not is a 400 (not a 503 the sender
// asks again on), applies nothing and is passed on to no one: a `hop` the cap cannot read would be
// passed on without end. A key under `__proto__` is no key, and nothing reaches Object.prototype.
// (A browser's form body is never parsed here: a mount forwards it to the peer as bytes, mount.ts.)
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

const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).sort();
const POLLUTION = '{"og_polluted":"yes","id":"p","tags":"all"}';

/** A raw notice body, signed by the peer as federate.ts post_thaw signs one. */
function thaw_event(text: string): RequestEvent {
	const url = new URL(THAW_PATH, 'http://shell.test');
	const bytes = new TextEncoder().encode(text);
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
	expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTO_NAMES);
	expect(({} as Record<string, unknown>).og_polluted).toBeUndefined();
	expect(([] as unknown as Record<string, unknown>).og_polluted).toBeUndefined();
});

/** This app and its one peer, the cms: what it applies it passes on to its peers. */
function setup() {
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
	const applied: unknown[] = [];
	const leave = register_hooks({
		invalidate(tags: string[]) {
			applied.push(tags);
		}
	});
	return { applied, forwarded, leave };
}

describe('a thaw notice not of the notice’s shape (#988)', () => {
	const MALFORMED = [
		`{"id":"n-1","hop":0,"tags":{"__proto__":${POLLUTION}}}`,
		`{"id":"n-2","hop":0,"tags":{"0":"s:a","length":1}}`,
		`{"id":"n-3","hop":0,"tags":"some"}`,
		`{"id":"n-4","hop":0,"tags":["s:a",{"__proto__":${POLLUTION}}]}`,
		`{"id":"n-5","hop":0,"tags":["s:a",7]}`,
		`{"id":"n-6","hop":{"__proto__":${POLLUTION}},"tags":["s:a"]}`,
		`{"id":"n-7","hop":"1","tags":["s:a"]}`,
		`{"id":"n-8","hop":-1,"tags":["s:a"]}`,
		`{"id":"n-9","hop":1.5,"tags":["s:a"]}`,
		`{"id":{"__proto__":${POLLUTION}},"hop":0,"tags":["s:a"]}`,
		`{"id":7,"hop":0,"tags":["s:a"]}`,
		`[{"id":"n-10","hop":0,"tags":["s:a"]}]`,
		`null`
	];

	it('is refused with a 400, applies nothing, and is passed on to no one', async () => {
		const { applied, forwarded, leave } = setup();
		try {
			const statuses: number[] = [];
			for (const body of MALFORMED) {
				// (a throw is what the app would answer 500 for)
				const res = await serve_federation(thaw_event(body)).catch(() => null);
				statuses.push(res?.status ?? 500);
				await res?.text();
			}
			expect(statuses).toEqual(MALFORMED.map(() => 400));
			await new Promise((r) => setTimeout(r, 0));
			expect(applied).toEqual([]);
			expect(forwarded).toEqual([]);
		} finally {
			leave();
		}
	});

	it('a key under `__proto__` is no key: `tags: "all"` there thaws nothing', async () => {
		const { applied, leave } = setup();
		try {
			for (const body of [
				`{"__proto__":${POLLUTION},"hop":0}`,
				`{"constructor":{"prototype":${POLLUTION}},"hop":0}`
			]) {
				const res = await serve_federation(thaw_event(body));
				expect(res!.status, body).toBe(200);
				await res!.text();
			}
			expect(applied).toEqual([]);
		} finally {
			leave();
		}
	});

	it('a notice of the shape is still applied and passed on', async () => {
		const { applied, forwarded, leave } = setup();
		try {
			const res = await serve_federation(
				thaw_event(`{"id":"n-ok","hop":2,"tags":["s:doc:1"],"from":"cms"}`)
			);
			expect(res!.status).toBe(200);
			expect(applied).toEqual([['r:cms:s:doc:1']]);
			await new Promise((r) => setTimeout(r, 0));
			expect(forwarded.length).toBe(1);
		} finally {
			leave();
		}
	});
});
