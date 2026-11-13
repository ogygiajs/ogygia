// A federation route whose request body breaks off mid-upload (a client that aborts or resets)
// answers 400, as a body that is not what the route takes does; the error never escapes the route
// as a thrown one (#1427).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';
import { reset_deploy_thaw_for_tests, serve_federation } from '../src/serve.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import fed_server from '../src/server.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
	reset_deploy_thaw_for_tests();
});

/** A body that sends one piece and then fails. */
function breaks(): ReadableStream<Uint8Array> {
	let sent = false;
	return new ReadableStream({
		pull(c) {
			if (sent) return c.error(new Error('connection reset'));
			sent = true;
			c.enqueue(new Uint8Array(16).fill(0x61));
		}
	});
}

function post(url: URL) {
	const request = new Request(url, {
		method: 'POST',
		body: breaks(),
		duplex: 'half'
	} as RequestInit);
	return serve_federation({ url, request } as never);
}

describe('a federation body that breaks off mid-upload is a 400 (#1427)', () => {
	it('the exposed table', async () => {
		vi.stubGlobal('fetch', async () => new Response('{}'));
		let reached = false;
		federate({
			name: 'cms',
			expose: {
				fetch: async () => {
					reached = true;
					return new Response('ok');
				}
			} as never,
			peers: {},
			open: true
		});
		const url = new URL('https://cms.internal/og/fragment/page');
		url.searchParams.set('path', '/me');
		const res = (await post(url))!;
		expect(res.status).toBe(400);
		expect(reached).toBe(false);
	});

	it('a thaw notice', async () => {
		vi.stubGlobal('fetch', async () => new Response('{}'));
		federate({ name: 'cms', peers: {} });
		const res = (await post(new URL('https://cms.internal/og/thaw')))!;
		expect(res.status).toBe(400);
	});
});
