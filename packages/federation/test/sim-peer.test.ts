// SIMULATION of a federation peer (src/peer.ts): reads of two pages, thaws of the sources they read,
// a thaw of everything (a deploy), mutations, visitors who leave, and the upstream's answers (pages,
// errors, a dropped connection) in every order the scheduler tries:
// - no doubled side effect: never two upstream fetches out for one page between two thaws of it
//   (an old fetch's end never removes the newer one, #210; a thaw of other sources keeps it, #294);
// - newest answer wins: a read gets the page as it was when it asked, or newer, never the page
//   from before a thaw or a mutation it came after (#210, #294);
// - once all is quiet, a read gets the page as it is now;
// - no kept failure (the server's rules), and every read settles.
import { afterEach, describe, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { PeerHandle } from '../src/peer.ts';
import { set_current_request } from '../../core/src/plugin/facts.ts';
import { server_rules_hold } from '../../core/test/sim/_server.ts';

type Path = '/p' | '/q';
/** The source each page reads. */
const SOURCE: Record<Path, string> = { '/p': 'x', '/q': 'y' };
type Step =
	| { kind: 'read'; path: Path; in_request: boolean; leaves: boolean }
	| { kind: 'publish'; source: 'x' | 'y' }
	| { kind: 'deploy' }
	| { kind: 'post'; path: Path };

const path = fc.constantFrom<Path>('/p', '/q');
const step: fc.Arbitrary<Step> = fc.oneof(
	{
		weight: 6,
		arbitrary: fc.record({
			kind: fc.constant('read'),
			path,
			in_request: fc.boolean(),
			leaves: fc.boolean()
		})
	},
	{
		weight: 2,
		arbitrary: fc.record({ kind: fc.constant('publish'), source: fc.constantFrom('x', 'y') })
	},
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('deploy') }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('post'), path }) }
) as fc.Arbitrary<Step>;

afterEach(() => set_current_request(null));

describe('a federation peer, simulated', () => {
	it('fetches each page once per thaw, and never serves a page from before what it saw', async () => {
		await simulate.check(
			[
				fc.array(fc.constantFrom('page', 'page', 'page', '500', 'dropped'), {
					minLength: 8,
					maxLength: 8
				}),
				fc.array(step, { minLength: 1, maxLength: 9 })
			],
			async (sim, answers, steps) => {
				server_rules_hold(sim);
				let current: Request | undefined;
				set_current_request(() => current);
				/** each page's version upstream, and its epoch here (a thaw of it starts a new one) */
				const version: Record<Path, number> = { '/p': 0, '/q': 0 };
				const epoch: Record<Path, number> = { '/p': 0, '/q': 0 };
				type Out = { path: Path; epoch: number; signal: AbortSignal | null; done: boolean };
				const out: Out[] = [];
				let n_answer = 0;
				sim.fetch((request) => {
					const url = new URL(request.url);
					const p = url.searchParams.get('path') as Path;
					if (request.method === 'POST') {
						version[p]++; // the upstream applies the mutation, and answers
						return Response.json({
							status: 200,
							title: 't',
							css: [],
							body: `${p}@${version[p]}`,
							path: p,
							sources: [SOURCE[p]]
						});
					}
					const kind = answers[n_answer++ % answers.length];
					if (kind === 'dropped') throw new TypeError('fetch failed');
					if (kind === '500') return new Response('down', { status: 500 });
					return Response.json({
						status: 200,
						title: 't',
						css: [],
						body: `${p}@${version[p]}`,
						path: p,
						sources: [SOURCE[p]]
					});
				});
				const real_fetch = globalThis.fetch;
				globalThis.fetch = ((input: URL, init?: RequestInit) => {
					const p = new URL(String(input)).searchParams.get('path') as Path;
					const o: Out | null =
						init?.method === undefined || init.method === 'GET'
							? { path: p, epoch: epoch[p], signal: init?.signal ?? null, done: false }
							: null;
					if (o !== null) out.push(o);
					return real_fetch(input, init).finally(() => o !== null && (o.done = true));
				}) as typeof fetch;
				const cms = new PeerHandle(
					'cms',
					{ origin: 'http://mfe.test', cache: { ttl: 60_000 } },
					'shell'
				);
				type Read = { path: Path; asked: number; got: string; left: boolean };
				const reads: Read[] = [];
				const thaw = (p: Path) => epoch[p]++;

				sim.always(
					'no doubled side effect: one upstream fetch per page between thaws (#210, #294)',
					() => {
						for (const p of ['/p', '/q'] as const) {
							const live = out.filter(
								(o) => o.path === p && o.epoch === epoch[p] && !o.done && !o.signal?.aborted
							);
							if (live.length > 1) return `${live.length} fetches of ${p} out in epoch ${epoch[p]}`;
						}
						return null;
					}
				);
				sim.always('newest answer wins: never a page from before what the read came after', () => {
					for (const [i, r] of reads.entries()) {
						const m = /@(\d+)$/.exec(r.got);
						if (m && Number(m[1]) < r.asked)
							return `read ${i} of ${r.path} asked at version ${r.asked}, got ${r.got}`;
					}
					return null;
				});

				const read = (
					p: Path,
					in_request: boolean,
					leave: AbortController | null,
					last = false
				) => {
					const r: Read = { path: p, asked: version[p], got: '', left: false };
					reads.push(r);
					current = in_request
						? new Request(`https://shell.test${p}`, { signal: leave?.signal })
						: undefined;
					const doc = cms.doc(p, '');
					current = undefined;
					return doc.then(
						(d) => {
							r.got = d.body;
							if (last && d.body !== `${p}@${version[p]}`)
								sim.broke(
									'once quiet, a read gets the page as it is',
									`${p}: ${d.body}, upstream ${version[p]}`
								);
						},
						(e: unknown) => (r.got = `failed: ${String((e as { status?: number })?.status ?? e)}`)
					);
				};
				const play: Array<readonly [string, () => unknown]> = [];
				for (const s of steps) {
					if (s.kind === 'read') {
						const leave = s.in_request && s.leaves ? new AbortController() : null;
						play.push([
							`read ${s.path}${s.in_request ? ' in a request' : ''}`,
							() => read(s.path, s.in_request, leave)
						]);
						if (leave)
							play.push([
								`that read's visitor leaves`,
								() => leave.abort(new Error('visitor left'))
							]);
					} else if (s.kind === 'publish')
						play.push([
							`publish ${s.source} (its thaw lands)`,
							() => {
								for (const p of ['/p', '/q'] as const)
									if (SOURCE[p] === s.source) {
										version[p]++;
										thaw(p);
									}
								cms.drop(new Set([`r:cms:${s.source}`]));
							}
						]);
					else if (s.kind === 'deploy')
						play.push([
							'a deploy thaws everything',
							() => (thaw('/p'), thaw('/q'), cms.drop('all'))
						]);
					else
						play.push([
							`post to ${s.path}`,
							() => {
								// a mutation is out from its start to its end: what is read meanwhile may be
								// from before it (#331)
								thaw('/p');
								thaw('/q');
								const ended = () => (thaw('/p'), thaw('/q'));
								return cms
									.postDoc(s.path, '', new ArrayBuffer(0), 'application/x-www-form-urlencoded')
									.then(ended, ended);
							}
						]);
				}
				await sim.play(play);
				// once all is quiet, every page read now is the page as it is upstream (the answers
				// here are all good: the upstream is back)
				answers.fill('page');
				await sim.play([
					['last read of /p', () => read('/p', false, null, true)],
					['last read of /q', () => read('/q', false, null, true)]
				]);
			},
			{ runs: 1000 }
		);
	});
});
