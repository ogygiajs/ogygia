// Work that belongs to whoever started it (#198, #210): an old peer request's cleanup never removes
// a newer one, and a deploy thaw that could not finish is tried again, not forgotten.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '$app/env';
import { PeerHandle } from '../src/peer.ts';
import { federate } from '../src/federate.ts';
import { current_federation, set_federation } from '../src/registry.ts';
import { deploy_thaw_check, reset_deploy_thaw_for_tests } from '../src/serve.ts';
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
		cms.drop('all'); // a thaw lands while that fetch is out
		const fresh = cms.doc('/p', ''); // the next read fetches again (the old answer is stale)
		await tick();
		expect(answers).toHaveLength(2);
		answers[0](new Response(doc_json('old'))); // the OLD fetch ends …
		await old;
		await tick();
		const joined = cms.doc('/p', ''); // … and a read now must join the NEW fetch, not start a third
		await tick();
		expect(answers).toHaveLength(2);
		for (const answer of answers.slice(1)) answer(new Response(doc_json('new')));
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

	it('the peer never takes the thaw: the marker is put back, and a later request thaws again', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const p = producer({ peer_down: 4 }); // every attempt of the first broadcast fails
		const first = deploy_thaw_check(p.fed);
		await vi.advanceTimersByTimeAsync(10_000); // through the broadcast's own retries
		await first;
		expect(p.thaws).toHaveLength(0);
		expect(p.marker()).toBe('the build before'); // not marked done while nobody thawed
		await vi.advanceTimersByTimeAsync(60_000);
		const second = deploy_thaw_check(p.fed);
		await vi.advanceTimersByTimeAsync(10_000);
		await second;
		expect(p.thaws).toHaveLength(1);
		expect(p.marker()).toBe(version);
		p.off();
	});

	it('the peer never takes the thaw AND the store is down for putting the marker back: a later check still thaws', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const p = producer({ peer_down: 4 });
		// the store answers the first ask (moving the marker to the new build), then is down for the
		// rollback: the marker stays on the new build, so lastBuild alone no longer says a thaw is owed
		let calls = 0;
		const real_off = registered.pop()!;
		real_off();
		registered.push(
			register_hooks({
				lastBuild(v: string) {
					calls++;
					if (calls === 1) return 'the build before';
					if (calls === 2) throw new Error('store unreachable');
					return v; // the marker says the new build from here on
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
		expect(p.thaws).toHaveLength(1); // still owed: thawed though the marker already moved
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
