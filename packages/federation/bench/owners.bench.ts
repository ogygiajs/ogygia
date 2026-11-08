// Work that belongs to whoever started it: a peer's reads joining the request in flight across
// drops (an old request ending never removes the newer one), and the deploy thaw's machine, its
// checks failing (a peer that never takes the notice) and finishing. The network is a stand-in
// fetch: nothing leaves the process.
import { bench } from '@bench/heisenbench/bench';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { PeerHandle } from '../src/peer.ts';
import { federate } from '../src/federate.ts';
import { current_federation } from '../src/registry.ts';
import {
	DEPLOY_THAW_ROUNDS,
	deploy_thaw_check,
	reset_deploy_thaw_for_tests
} from '../src/serve.ts';
import { FEDERATION_WARNINGS } from '../src/messages.ts';
import fed_server from '../src/server.ts';
import { register_hooks } from '../../core/src/plugin/hooks.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

const DOC = JSON.stringify({ status: 200, title: 't', css: [], body: 'B' });

/** Runs `work` with `fetch` answered by `answer`. */
async function with_fetch<T>(
	answer: (url: string) => Response,
	work: () => Promise<T>
): Promise<T> {
	const g = globalThis as { fetch: typeof fetch };
	const real = g.fetch;
	g.fetch = (async (input: RequestInfo | URL) => answer(String(input))) as typeof fetch;
	try {
		return await work();
	} finally {
		g.fetch = real;
	}
}

bench(
	'federation peer: reads joining the request in flight, across drops',
	({ n }) =>
		with_fetch(
			() => new Response(DOC),
			async () => {
				const peer = new PeerHandle(
					'cms',
					{ origin: 'http://mfe.test', cache: { ttl: 60_000 } },
					'shell'
				);
				let read = 0;
				for (let i = 0; i < n; i++) {
					const path = `/p${i % 5}`;
					const first = peer.doc(path, '');
					if (i % 3 === 0) peer.drop('all'); // a thaw lands while it is out
					const second = peer.doc(path, '');
					const [a, b] = await Promise.all([first, second]);
					read += a.body.length + b.body.length;
				}
				return read;
			}
		),
	{ setup: () => ({ n: 60 }), scale: (_ctx, k) => ({ n: 60 * k }) }
);

bench(
	'federation deploy thaw: checks that fail (a peer down) and checks that finish',
	async ({ n }) => {
		federate({
			name: 'cms',
			expose: {} as never,
			peers: { shell: { origin: 'http://shell.test' } },
			open: true
		});
		const fed = current_federation()!;
		let marker = 'the build before';
		const off = register_hooks({
			lastBuild(v: string) {
				const seen = marker;
				marker = v;
				return seen;
			}
		});
		const warn = console.warn;
		console.warn = () => {};
		let peer_down = false;
		let thaws = 0;
		try {
			await with_fetch(
				() => {
					if (peer_down) throw new TypeError('fetch failed');
					thaws++;
					return new Response('{}');
				},
				async () => {
					for (let i = 0; i < n; i++) {
						reset_deploy_thaw_for_tests(); // a fresh boot
						marker = 'the build before';
						// (the store is never down here: the shared hook says so once per server, so a run
						// after the first would count less; owners.test.ts proves that path)
						peer_down = i % 2 === 1;
						// requests during a check join it
						await Promise.all([deploy_thaw_check(fed), deploy_thaw_check(fed)]);
					}
				}
			);
		} finally {
			console.warn = warn;
			off();
		}
		return thaws;
	},
	{ setup: () => ({ n: 9 }), scale: (_ctx, k) => ({ n: 9 * k }) }
);

bench(
	'federation: the deploy thaw given up, worded',
	({ peers }) => {
		const said = FEDERATION_WARNINGS.federation_deploy_thaw_undelivered;
		return said.text({ peers, rounds: DEPLOY_THAW_ROUNDS }).length + said.details().length;
	},
	{ setup: () => ({ peers: 'blog, docs' }) }
);
