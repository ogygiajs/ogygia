// Work that belongs to whoever started it (#198, #210): an old peer request's cleanup never removes
// a newer one, and a deploy thaw that could not finish is tried again, not forgotten.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '$app/env';
import { PeerHandle } from '../src/peer.ts';
import { federate } from '../src/federate.ts';
import { current_federation, set_federation } from '../src/registry.ts';
import {
	DEPLOY_THAW_ROUNDS,
	deploy_thaw_check,
	reset_deploy_thaw_for_tests
} from '../src/serve.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import fed_server from '../src/server.ts';
import { register_hooks } from '../../core/src/plugin/hooks.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

const doc_json = (body: string) => JSON.stringify({ status: 200, title: 't', css: [], body });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Store hooks a test registered: taken off after it, pass or fail (a left one answers the next). */
const registered: Array<() => void> = [];

afterEach(() => {
	for (const off of registered.splice(0)) off();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
	reset_deploy_thaw_for_tests();
});

describe('a peer request belongs to the generation that started it (#210)', () => {
	it('after a drop, the old request ending does not remove the new one: no second upstream fetch', async () => {
		const answers: Array<(r: Response) => void> = [];
		vi.stubGlobal('fetch', () => new Promise<Response>((r) => answers.push(r)));
		const cms = new PeerHandle(
			'cms',
			{ origin: 'http://mfe.test', cache: { ttl: 60_000 } },
			'shell'
		);
		const old = cms.doc('/p', '');
		await tick();
		cms.drop('all'); // a thaw lands while that fetch is out: its caller reads again
		const fresh = cms.doc('/p', ''); // the next read joins that new fetch
		await tick();
		expect(answers).toHaveLength(2);
		answers[0](new Response(doc_json('old'))); // the OLD fetch ends …
		await tick();
		const joined = cms.doc('/p', ''); // … and a read now must join the NEW fetch, not start a third
		await tick();
		expect(answers).toHaveLength(2);
		for (const answer of answers.slice(1)) answer(new Response(doc_json('new')));
		expect((await old).body).toBe('new');
		expect((await fresh).body).toBe('new');
		expect((await joined).body).toBe('new');
	});
});

describe('the deploy thaw is tried again until it is done (#198)', () => {
	/** A producer app with one peer, a store that answers `lastBuild`, and the peer's thaw endpoint. */
	function producer(opts: { store_down?: number; peer_down?: number }) {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		federate({
			name: 'cms',
			expose: {} as never,
			peers: { shell: { origin: 'http://shell.test' } },
			open: true
		});
		let marker = 'the build before';
		let store_down = opts.store_down ?? 0;
		const asked: string[] = [];
		const off = register_hooks({
			// (taken off in afterEach)
			lastBuild(v: string) {
				asked.push(v);
				if (store_down > 0) {
					store_down--;
					throw new Error('store unreachable');
				}
				const seen = marker;
				marker = v;
				return seen;
			}
		});
		let peer_down = opts.peer_down ?? 0;
		const thaws: string[] = [];
		vi.stubGlobal('fetch', async (url: URL | string) => {
			if (peer_down > 0) {
				peer_down--;
				throw new TypeError('fetch failed');
			}
			thaws.push(String(url));
			return new Response('{}', { status: 200 });
		});
		registered.push(off);
		return { fed: current_federation()!, thaws, asked, marker: () => marker, off };
	}

	it('the store is down for the first check: a later request checks again and thaws', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const p = producer({ store_down: 1 });
		await deploy_thaw_check(p.fed);
		expect(p.thaws).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(60_000);
		await deploy_thaw_check(p.fed);
		expect(p.thaws).toHaveLength(1);
		expect(p.marker()).toBe(version);
		p.off();
	});

	it('the peer never takes the thaw: a later request thaws again, and the store is asked once', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const p = producer({ peer_down: 4 }); // every attempt of the first broadcast fails
		const first = deploy_thaw_check(p.fed);
		await vi.advanceTimersByTimeAsync(10_000); // through the broadcast's own retries
		await first;
		expect(p.thaws).toHaveLength(0);
		// the marker stays on this build: this instance owes the thaw, and every other instance of
		// the app would otherwise thaw every peer again
		expect(p.marker()).toBe(version);
		await vi.advanceTimersByTimeAsync(60_000);
		const second = deploy_thaw_check(p.fed);
		await vi.advanceTimersByTimeAsync(10_000);
		await second;
		expect(p.thaws).toHaveLength(1);
		expect(p.asked).toEqual([version]);
		p.off();
	});

	it('the peer never takes the thaw AND the store goes down after the first ask: the owed thaw goes without asking it again', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const p = producer({ peer_down: 4 });
		// the store answers the first ask (moving the marker to the new build), then is down: an owed
		// thaw is this instance's to send, so nothing asks the store again for it
		let calls = 0;
		const real_off = registered.pop()!;
		real_off();
		registered.push(
			register_hooks({
				lastBuild() {
					calls++;
					if (calls === 1) return 'the build before';
					throw new Error('store unreachable');
				}
			})
		);
		const first = deploy_thaw_check(p.fed);
		await vi.advanceTimersByTimeAsync(10_000);
		await first;
		expect(p.thaws).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(60_000);
		const second = deploy_thaw_check(p.fed);
		await vi.advanceTimersByTimeAsync(10_000);
		await second;
		expect(p.thaws).toHaveLength(1); // still owed: thawed from what the first check found
		expect(calls).toBe(1); // the store was asked once
	});

	it('done is done: a check after a successful thaw does nothing', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const p = producer({});
		await deploy_thaw_check(p.fed);
		await vi.advanceTimersByTimeAsync(120_000);
		await deploy_thaw_check(p.fed);
		expect(p.thaws).toHaveLength(1);
		expect(p.asked).toEqual([version]);
		p.off();
	});

	it('requests during a check join it (one check, one thaw)', async () => {
		const p = producer({});
		await Promise.all([
			deploy_thaw_check(p.fed),
			deploy_thaw_check(p.fed),
			deploy_thaw_check(p.fed)
		]);
		expect(p.asked).toEqual([version]);
		expect(p.thaws).toHaveLength(1);
		p.off();
	});
});

describe('a deploy thaw is owed to the peers that missed it, not to every peer', () => {
	/** A producer with three peers; `refuses(peer)` says whether that peer refuses this thaw post. */
	function producer(refuses: (peer: string, posts: number) => boolean) {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		federate({
			name: 'cms',
			expose: {} as never,
			peers: {
				shell: { origin: 'http://shell.test' },
				docs: { origin: 'http://docs.test' },
				blog: { origin: 'http://blog.test' }
			},
			open: true
		});
		let marker = 'the build before';
		registered.push(
			register_hooks({
				lastBuild(v: string) {
					const seen = marker;
					marker = v;
					return seen;
				}
			})
		);
		const took: Record<string, number> = { shell: 0, docs: 0, blog: 0 };
		const posts: Record<string, number> = { shell: 0, docs: 0, blog: 0 };
		const ids = new Set<string>();
		vi.stubGlobal('fetch', async (url: URL | string, init?: RequestInit) => {
			const peer = new URL(String(url)).hostname.split('.')[0];
			posts[peer]++;
			ids.add(JSON.parse(new TextDecoder().decode(init!.body as ArrayBuffer)).id);
			// a WAF in front of it, or a peer that has no key for this app
			if (refuses(peer, posts[peer])) return new Response('no', { status: 401 });
			took[peer]++;
			return new Response('{}', { status: 200 });
		});
		return { fed: current_federation()!, took, posts, ids, warn };
	}

	/** One check, through the broadcast's own retries. */
	async function check(fed: ReturnType<typeof current_federation> & object) {
		const run = deploy_thaw_check(fed);
		await vi.advanceTimersByTimeAsync(10_000);
		await run;
	}

	it('one peer refuses: only it is sent the thaw again, the others take it once', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		// the blog refuses its first round (four posts with the retries), then takes it
		const p = producer((peer, n) => peer === 'blog' && n <= 4);
		await check(p.fed);
		expect(p.took).toEqual({ shell: 1, docs: 1, blog: 0 });
		for (let i = 0; i < 5; i++) {
			await vi.advanceTimersByTimeAsync(31_000);
			await check(p.fed);
		}
		// healthy peers never purge again for the same deploy; the blog got it on the next round
		expect(p.took).toEqual({ shell: 1, docs: 1, blog: 1 });
		expect(p.posts.shell).toBe(1);
		expect(p.posts.docs).toBe(1);
		expect(p.ids.size).toBe(1); // one notice, sent again: a peer that forwards it dedupes it
	});

	it('a peer that never takes it: given up after a bounded number of rounds, with a warning naming it', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const p = producer((peer) => peer === 'blog');
		for (let i = 0; i < 40; i++) {
			await check(p.fed);
			await vi.advanceTimersByTimeAsync(31_000);
		}
		const rounds = p.posts.blog / 4; // each round posts four times (its retries)
		expect(rounds).toBe(DEPLOY_THAW_ROUNDS);
		expect(p.took).toEqual({ shell: 1, docs: 1, blog: 0 });
		const said = p.warn.mock.calls.filter((c) =>
			String(c[0]).includes('federation_deploy_thaw_undelivered')
		);
		expect(said).toHaveLength(1);
		expect(said[0].join(' ')).toContain('blog');
	});
});
