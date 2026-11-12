// A peer may serve its island code from its own assets origin (a CDN), which the shell's config does
// not name (#856). The peer's fragment says where its runtime is (`runtime`, made by the peer's
// `lift_document`): a fragment the shell used in a request adds that origin to the request's code
// origins, and only from an answer of a configured peer origin. Not from a redirect elsewhere, not
// from a value that is not an http(s) URL.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { PeerHandle } from '../src/peer.ts';
import { set_federation } from '../src/registry.ts';
import fed_server from '../src/server.ts';
import { facts_of, set_current_request } from '../../core/src/plugin/facts.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

const doc = (extra: Record<string, unknown>) =>
	JSON.stringify({ status: 200, title: 't', css: [], body: 'B', ...extra });
/** A fetch answering `body`, as if from `answered_url` (a redirect lands there). */
const answer = (body: string, answered_url?: string) =>
	vi.stubGlobal('fetch', async (u: URL) => {
		const res = new Response(body);
		Object.defineProperty(res, 'url', { value: answered_url ?? String(u) });
		return res;
	});

/** The code origins a request learned while it used `cms`'s page. */
async function learned(peer: PeerHandle): Promise<string[] | undefined> {
	const request = new Request('https://shell.example/p');
	set_current_request(() => request);
	await peer.page('/p');
	return facts_of(request).codeOrigins;
}

afterEach(() => {
	vi.unstubAllGlobals();
	set_federation(null);
	set_current_request(null);
});

describe('a peer fragment’s runtime origin', () => {
	it('joins the request’s code origins when the fragment is used', async () => {
		answer(doc({ runtime: 'https://cdn.cms.example/_app/immutable/og-runtime.Ab12.js' }));
		const cms = new PeerHandle('cms', { origin: 'https://cms.example' }, 'shell');
		expect(await learned(cms)).toEqual(['https://cdn.cms.example']);
	});

	it('not from an answer a redirect took to another origin', async () => {
		answer(
			doc({ runtime: 'https://evil.example/og-runtime.js' }),
			'https://evil.example/og/fragment/page'
		);
		const cms = new PeerHandle('cms', { origin: 'https://cms.example' }, 'shell');
		expect(await learned(cms)).toBeUndefined();
	});

	it('not from a runtime that is not an http(s) URL', async () => {
		answer(doc({ runtime: 'javascript:alert(1)' }));
		const cms = new PeerHandle('cms', { origin: 'https://cms.example' }, 'shell');
		expect(await learned(cms)).toBeUndefined();
	});

	it('no runtime named: nothing', async () => {
		answer(doc({}));
		const cms = new PeerHandle('cms', { origin: 'https://cms.example' }, 'shell');
		expect(await learned(cms)).toBeUndefined();
	});
});
