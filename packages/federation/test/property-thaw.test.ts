/**
 * Any body a known peer signs and posts to `/og/thaw` is answered, never thrown: 200 when it is a
 * notice of the notice's shape (`id` a string, `hop` a whole number from 0, `tags` `'all'` or
 * strings), 400 for anything else, and nothing reaches Object.prototype.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { fc } from '@ogygia/config/sim';
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

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
	expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTO_NAMES);
});

/** `bytes` as the cms posts a notice: signed with its key */
function thaw_event(bytes: Uint8Array): RequestEvent {
	const url = new URL(THAW_PATH, 'http://shell.test');
	const body = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer;
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

const is_notice = (v: unknown): boolean => {
	if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
	const { id = '', hop = 0, tags = [] } = v as Record<string, unknown>;
	return (
		typeof id === 'string' &&
		Number.isSafeInteger(hop) &&
		(hop as number) >= 0 &&
		(tags === 'all' || (Array.isArray(tags) && tags.every((t) => typeof t === 'string')))
	);
};

/** near-notices (each field any JSON, sometimes the right type), any JSON, any text, any bytes */
const field = <T>(right: fc.Arbitrary<T>) => fc.oneof(right, fc.jsonValue());
const body = fc.oneof(
	fc
		.record(
			{
				id: field(fc.string()),
				hop: field(fc.integer({ min: -2, max: 6 })),
				tags: field(fc.oneof(fc.constant('all'), fc.array(fc.string(), { maxLength: 3 })))
			},
			{ requiredKeys: [] }
		)
		.map((v) => new TextEncoder().encode(JSON.stringify(v))),
	fc.jsonValue().map((v) => new TextEncoder().encode(JSON.stringify(v) ?? '')),
	fc.string().map((s) => new TextEncoder().encode(s)),
	fc.uint8Array({ maxLength: 64 })
);

describe('serve_thaw with any signed body', () => {
	it('answers 200 for a notice of the notice’s shape and 400 for anything else, never throws', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', async () => new Response('{}'));
		federate({
			name: 'shell',
			audience: 'shell.test',
			peers: { cms: { origin: 'http://cms.test', key: cms_pub } }
		});
		const leave = register_hooks({ invalidate() {} });
		try {
			await fc.assert(
				fc.asyncProperty(body, async (bytes) => {
					let parsed: unknown;
					try {
						parsed = JSON.parse(new TextDecoder().decode(bytes));
					} catch {
						parsed = undefined;
					}
					const res = (await serve_federation(thaw_event(bytes)))!;
					expect(res.status).toBe(is_notice(parsed) ? 200 : 400);
				}),
				{ numRuns: 300 }
			);
		} finally {
			leave();
		}
	});
});
