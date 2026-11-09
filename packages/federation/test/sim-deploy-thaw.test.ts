// SIMULATION of the deploy thaw (src/serve.ts deploy_thaw_check, federate.ts broadcast_thaw): after
// a deploy, requests come at any time, the store that remembers the last build is down or up, and
// each peer takes the thaw, refuses it or is unreachable, in every order:
// - never lost (#198): once the store and the peers are back, a few requests later every peer has
//   taken the thaw, or a warning names the ones that never did;
// - the store is asked until it answers, and answers once: one instance owes the thaw;
// - no doubled side effect: one check at a time (requests meanwhile join it), never two posts to
//   one peer out at once, and a peer that took it is never sent it again;
// - one notice: every post carries the same id; the server's rules, and every request settles.
import { afterEach, describe, it, vi } from 'vitest';
import { fc, simulate, type SimStep } from '@ogygia/config/sim';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { federate } from '../src/federate.ts';
import { current_federation, set_federation } from '../src/registry.ts';
import { deploy_thaw_check, reset_deploy_thaw_for_tests } from '../src/serve.ts';
import fed_server from '../src/server.ts';
import { register_hooks } from '../../core/src/plugin/hooks.ts';
import { server_rules_hold } from '../../core/test/sim/_server.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

afterEach(() => {
	vi.restoreAllMocks();
	set_federation(null);
	reset_deploy_thaw_for_tests();
});

const PEERS = ['shell', 'docs'] as const;
type Peer = (typeof PEERS)[number];

describe('the deploy thaw, simulated', () => {
	it('reaches every peer once the store and the peers are back, sent once to each', async () => {
		const warns: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a.join(' ')));
		await simulate.check(
			[
				fc.record({
					store_down: fc.nat({ max: 2 }),
					/** how each post to each peer is answered while the peers are still failing */
					posts: fc.array(fc.constantFrom('takes it', 'refuses', 'unreachable'), {
						minLength: 6,
						maxLength: 6
					})
				}),
				fc.array(fc.constantFrom('a request', 'a request', '31 s pass'), {
					minLength: 1,
					maxLength: 8
				})
			],
			async (sim, o, steps) => {
				server_rules_hold(sim);
				reset_deploy_thaw_for_tests();
				warns.length = 0;
				federate({
					name: 'cms',
					expose: {} as never,
					peers: { shell: { origin: 'http://shell.test' }, docs: { origin: 'http://docs.test' } },
					open: true
				});
				const fed = current_federation()!;
				let marker = 'the build before';
				let store_down = o.store_down;
				let answers = 0;
				let checks_out = 0;
				const off = register_hooks({
					lastBuild: (v: string) =>
						sim.later(store_down > 0 ? 'the store is down' : 'the store answers', () => {
							if (store_down > 0) {
								store_down--;
								throw new Error('store unreachable');
							}
							answers++;
							const seen = marker;
							marker = v;
							return seen;
						})
				});
				let healthy = false;
				const took: Record<Peer, number> = { shell: 0, docs: 0 };
				const ids = new Set<string>();
				let post_n = 0;
				const sent_after_took: string[] = [];
				sim.fetch(async (request) => {
					const peer = new URL(request.url).hostname.split('.')[0] as Peer;
					ids.add(((await request.json()) as { id: string }).id);
					if (took[peer] > 0) sent_after_took.push(peer);
					const answer = healthy ? 'takes it' : o.posts[post_n++ % o.posts.length];
					if (answer === 'unreachable') throw new TypeError('fetch failed');
					if (answer === 'refuses') return new Response('no', { status: 503 });
					took[peer]++;
					return Response.json({ ok: true });
				});
				const real_fetch = globalThis.fetch;
				const posts: Array<{ peer: Peer; signal: AbortSignal | null; settled: boolean }> = [];
				globalThis.fetch = ((input: URL, init?: RequestInit) => {
					const post = {
						peer: new URL(String(input)).hostname.split('.')[0] as Peer,
						signal: init?.signal ?? null,
						settled: false
					};
					posts.push(post);
					return real_fetch(input, init).finally(() => (post.settled = true));
				}) as typeof fetch;

				sim.always('no doubled side effect: never two posts to one peer out', () => {
					for (const p of PEERS) {
						const out = posts.filter(
							(x) => x.peer === p && !x.settled && !x.signal?.aborted
						).length;
						if (out > 1) return `${out} posts to ${p} out`;
					}
					return null;
				});
				sim.always('one check at a time', () =>
					checks_out > 1 ? `${checks_out} checks out` : null
				);
				sim.always('a peer that took it is never sent it again', () =>
					sent_after_took.length > 0 ? `sent again to ${sent_after_took.join(', ')}` : null
				);
				sim.always('one notice: one id', () => (ids.size > 1 ? `${ids.size} notice ids` : null));
				sim.always('the store answers once', () =>
					answers > 1 ? `the store answered ${answers} times` : null
				);

				// (a request that joins the check out is handed that check's own promise)
				const checks = new Set<Promise<void>>();
				const request = () => {
					const check = deploy_thaw_check(fed);
					if (!checks.has(check)) {
						checks.add(check);
						checks_out++;
						void check.finally(() => checks_out--);
					}
					return check;
				};
				try {
					await sim.play(
						steps.map((s) =>
							s === '31 s pass'
								? ([s, () => new Promise((r) => setTimeout(r, 31_000)), 'then'] as const)
								: ([s, request] as const)
						)
					);
					// the store and the peers are back: requests keep coming, each 31 s after the last
					// one's check ended
					healthy = true;
					store_down = 0;
					const later: SimStep[] = [];
					for (let i = 0; i < 4; i++) {
						later.push(['31 s pass', () => new Promise((r) => setTimeout(r, 31_000)), 'then']);
						later.push(['a request', request, 'then']);
					}
					await sim.play(later);
					const never = PEERS.filter((p) => took[p] === 0);
					const named = warns.some(
						(w) =>
							w.includes('federation_deploy_thaw_undelivered') && never.every((p) => w.includes(p))
					);
					if (never.length > 0 && !named)
						sim.broke(
							'never lost (#198)',
							`${never.join(', ')} never took the thaw, and no warning names them`
						);
					if (answers !== 1) sim.broke('never lost (#198)', `the store answered ${answers} times`);
				} finally {
					off();
				}
			},
			{ runs: 300, horizon: 10 * 60_000 }
		);
	});
});
