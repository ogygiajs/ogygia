// An invalidation of this app's stored pages tells its peers (the shared `invalidated` hook). A peer
// that never takes the notice, after every retry, keeps serving its stored copy until it expires:
// that must be said, not dropped.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { inRequest, startPlugin } from '@ogygia/core/plugin/testing';
import { federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';
import fed_server from '../src/server.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

const { privateKey } = generateKeyPairSync('ed25519');
const key = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
});

describe('a thaw notice no peer took', () => {
	it('is said with the peers that missed it, once the retries are spent', async () => {
		vi.useFakeTimers();
		const warns: unknown[][] = [];
		vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
			warns.push(a);
		});
		let posts = 0;
		vi.stubGlobal('fetch', async () => {
			posts++;
			return new Response('down', { status: 500 });
		});
		federate({ name: 'cms', key, peers: { shell: { origin: 'http://shell.test' } } });
		await fed_server.invalidated!(['p:/x']);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(posts).toBe(4); // the first send and its three retries
		const said = warns.filter((a) => String(a[0]).includes('federation_thaw_notice_failed'));
		expect(said).toHaveLength(1);
		expect(said[0].join(' ')).toContain('shell');
	});
});

describe('a publish on a serverless platform (#286)', () => {
	it("hands the thaw broadcast to the request's waitUntil, which holds until a peer took it", async () => {
		let took = false;
		vi.stubGlobal('fetch', async () => {
			await new Promise((r) => setTimeout(r, 30));
			took = true;
			return Response.json({ ok: true });
		});
		federate({ name: 'cms', key, peers: { shell: { origin: 'http://shell.test' } } });
		const kept: Promise<unknown>[] = [];
		const platform = { context: { waitUntil: (work: Promise<unknown>) => kept.push(work) } };
		// the publish request: Kit's request store carries its event (and its platform) through
		// every await of the request
		await inRequest({ platform }, () => fed_server.invalidated!(['p:/x']));
		// the response goes out now; the instance is kept alive only for what waitUntil holds
		expect(kept).toHaveLength(1);
		expect(took).toBe(false);
		await Promise.all(kept);
		expect(took).toBe(true);
	});
});
