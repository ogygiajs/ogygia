// SIMULATION of postrender's request path (src/server.ts page/response/done, src/registry.ts
// flights + store + self-evict): visitors GET two pages, an editor publishes them, a form posts to
// them, and the store answers each get, put and evict when the scheduler says:
// - one render out per page between publishes: a stampede is one render (the stampede law);
// - newest answer wins: a GET that came after a publish of its page, or after a post to it, never
//   gets the page from before (#194, #283);
// - once all is quiet, what the store keeps for a page is the page as it is now (#194);
// - the server's rules, and every request is answered (a joined render never hangs, #194).
import { afterEach, describe, it, vi } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { startPlugin } from '@ogygia/core/plugin/testing';
import server, { type PostrenderServerOptions } from '../src/server.ts';
import { install, invalidate, mark_handled, reset_for_tests } from '../src/registry.ts';
import { MemoryStore } from '../src/memory-store.ts';
import { server_rules_hold } from '../../core/test/sim/_server.ts';

// the server half reads Kit's `$app/env`: no build, no dev server
vi.mock('$app/env', () => ({ building: false, dev: false, version: 'test' }));

type Url = '/a/' | '/b/';
type Step = { kind: 'get' | 'publish' | 'post'; url: Url };

const options: PostrenderServerOptions = { ttl: 60, default: true };
const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };

afterEach(() => reset_for_tests());

describe('postrender, simulated', () => {
	it('renders a stampede once, never serves a page from before a publish or a post', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await simulate.check(
			[
				fc.array(
					fc.record({
						kind: fc.constantFrom<Step['kind']>('get', 'get', 'get', 'publish', 'post'),
						url: fc.constantFrom<Url>('/a/', '/b/')
					}),
					{ minLength: 1, maxLength: 8 }
				)
			],
			async (sim, steps) => {
				server_rules_hold(sim);
				reset_for_tests();
				// a remote store that is up: each call is answered in any order against everything else,
				// but within 1 s (a store slower than the evict's 2 s deadline is a store that is down,
				// and a post then says so instead of waiting, #283)
				const store = new MemoryStore();
				const slow = <K extends 'get' | 'put' | 'evict' | 'evictByTag'>(op: K) => {
					const real = (store[op] as (...a: unknown[]) => unknown).bind(store);
					(store as unknown as Record<K, unknown>)[op] = (...a: unknown[]) =>
						new Promise((resolve) => {
							let answered = false;
							const answer = () => {
								if (answered) return;
								answered = true;
								resolve(real(...a));
							};
							void sim.later(`the store answers ${op} ${String(a[0])}`).then(answer);
							setTimeout(answer, 1000);
						});
				};
				slow('get');
				slow('put');
				slow('evict');
				slow('evictByTag');
				const runtime = install({ store });
				/** each page's version, and the epoch of its renders (a publish or a post starts one) */
				const version: Record<Url, number> = { '/a/': 0, '/b/': 0 };
				const epoch: Record<Url, number> = { '/a/': 0, '/b/': 0 };
				/** the version a GET must at least get: the version of the last publish or post that
				 *  had answered when it came */
				const floor: Record<Url, number> = { '/a/': 0, '/b/': 0 };
				type Render = { url: Url; epoch: number; ended: boolean };
				const renders: Render[] = [];
				const gets: Array<{ url: Url; floor: number; got: string }> = [];

				const page_of = (url: Url) =>
					`<html><head></head><body><p data-v="${version[url]}">${url}</p></body></html>`;

				const get = async (url: Url) => {
					const g = { url, floor: floor[url], got: '' };
					gets.push(g);
					const c = ctx(new Request(`http://x.test${url}`), { cookies: jar as never });
					mark_handled(c.event, runtime);
					try {
						const hit = await server.page?.(c);
						if (hit) {
							g.got = await hit.text();
							return;
						}
						const r: Render = { url, epoch: epoch[url], ended: false };
						renders.push(r);
						const html = await sim.later(
							`a render of ${url}`,
							() => ((r.ended = true), page_of(url))
						);
						const res = new Response(html, {
							status: 200,
							headers: { 'content-type': 'text/html' }
						});
						const out = await server.response?.(c, res);
						g.got = await (out ?? res).text();
					} finally {
						server.done?.(c);
					}
				};
				const post = async (url: Url) => {
					const c = ctx(new Request(`http://x.test${url}`, { method: 'POST' }), {
						cookies: jar as never
					});
					mark_handled(c.event, runtime);
					try {
						await server.page?.(c);
						await sim.later(`the post to ${url} is applied`, () => {
							version[url]++;
							epoch[url]++;
						});
						await server.response?.(
							c,
							new Response(null, { status: 303, headers: { location: url } })
						);
						floor[url] = Math.max(floor[url], version[url]); // its response went out
					} finally {
						server.done?.(c);
					}
				};
				const publish = async (url: Url) => {
					version[url]++;
					epoch[url]++;
					const v = version[url];
					await invalidate(url);
					floor[url] = Math.max(floor[url], v); // the publish answered
				};

				sim.always('one render out per page between publishes (the stampede law)', () => {
					for (const url of ['/a/', '/b/'] as const) {
						const out = renders.filter(
							(r) => r.url === url && r.epoch === epoch[url] && !r.ended
						).length;
						if (out > 1) return `${out} renders of ${url} out`;
					}
					return null;
				});
				sim.always(
					'newest answer wins: never the page from before a publish or post the GET came after (#194, #283)',
					() => {
						for (const [i, g] of gets.entries()) {
							const v = /data-v="(\d+)"/.exec(g.got)?.[1];
							if (v !== undefined && Number(v) < g.floor)
								return `GET ${i} of ${g.url} came after version ${g.floor}, got ${v}`;
						}
						return null;
					}
				);

				await sim.play(
					steps.map((s): readonly [string, () => unknown] => [
						`${s.kind} ${s.url}`,
						() => (s.kind === 'get' ? get(s.url) : s.kind === 'post' ? post(s.url) : publish(s.url))
					])
				);
				// once quiet: what the store keeps for each page is the page as it is now
				await sim.play(
					(['/a/', '/b/'] as const).map((url): readonly [string, () => unknown] => [
						`the store's copy of ${url}`,
						() =>
							store.get(url).then((entry) => {
								const v =
									entry?.kind === 'page' ? /data-v="(\d+)"/.exec(entry.html)?.[1] : undefined;
								if (v !== undefined && Number(v) !== version[url])
									sim.broke(
										'once quiet, the store keeps the page as it is (#194)',
										`${url} keeps version ${v}, now ${version[url]}`
									);
							})
					])
				);
			},
			{ runs: 500 }
		);
	});
});
