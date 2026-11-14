// SIMULATION of the server request scope (src/plugin/request-scope.ts): responses with no body, a
// body, a body the platform never reads (HEAD, a 304), read to the end, cancelled midway or left by
// the visitor, while the source's chunks come in any order against the visitor's moves:
// - the server's rules: once a response ended, its request's scope is closed (#320, #284);
// - the visitor who read to the end got every chunk, in order;
// - a source nobody reads any more is cancelled, and its request's work is let go (the scope's
//   timer, its fetch) the moment the visitor leaves;
// - every read settles.
import { describe, it } from 'vitest';
import { fc, SimStream, simulate } from '@ogygia/config/sim';
import { own_response, request_scope } from '../../src/plugin/request-scope.ts';
import { server_rules_hold } from './_server.ts';

type Shape = 'no body' | 'body' | 'HEAD' | '304';
type Visitor = 'reads to the end' | 'reads one, then cancels' | 'leaves' | 'reads nothing';

describe('the request scope, simulated', () => {
	it('closes once its response ends, however it ends', async () => {
		await simulate.check(
			[
				fc.array(
					fc.record({
						shape: fc.constantFrom<Shape>('no body', 'body', 'body', 'HEAD', '304'),
						visitor: fc.constantFrom<Visitor>(
							'reads to the end',
							'reads one, then cancels',
							'leaves',
							'reads nothing'
						),
						chunks: fc.integer({ min: 1, max: 3 })
					}),
					{ minLength: 1, maxLength: 3 }
				)
			],
			async (sim, requests) => {
				server_rules_hold(sim);
				const steps: Array<readonly [string, () => unknown]> = [];
				requests.forEach((r, i) => {
					const visitor = new AbortController();
					const etag = '"v1"';
					const request = new Request(`https://app.test/${i}`, {
						method: r.shape === 'HEAD' ? 'HEAD' : 'GET',
						headers: r.shape === '304' ? { 'if-none-match': etag } : {},
						signal: visitor.signal
					});
					const chunks = Array.from({ length: r.chunks }, (_, k) => `<p>${i}.${k}</p>`);
					const source = new SimStream(sim, `request ${i}'s page`, chunks);
					let fetch_signal: AbortSignal | null = null;
					let response: Response | null = null;
					let read = '';
					let read_to_end = false;
					steps.push([
						`request ${i} (${r.shape}) is answered`,
						() => {
							const owner = request_scope(request);
							// the request's own work: a timer and a fetch it holds until it ends
							owner.timeout(() => {}, 60_000);
							fetch_signal = owner.signal;
							const answer = new Response(r.shape === 'no body' ? null : source.body, {
								status: 200,
								headers: { 'content-type': 'text/html', etag }
							});
							response = own_response(owner, answer, request);
						}
					]);
					steps.push([
						`request ${i}'s visitor ${r.visitor}`,
						async () => {
							if (response === null || response.body === null) return;
							if (r.visitor === 'leaves') return visitor.abort();
							if (r.visitor === 'reads nothing') return;
							const reader = response.body.getReader();
							for (;;) {
								const step = await reader.read();
								if (step.done) {
									read_to_end = true;
									return;
								}
								read += new TextDecoder().decode(step.value);
								if (r.visitor === 'reads one, then cancels') return reader.cancel();
							}
						}
					]);
					sim.finally(`request ${i}: what the visitor read`, () => {
						if (read_to_end && r.shape === 'body' && read !== chunks.join(''))
							return `read ${read}, sent ${chunks.join('')}`;
						return null;
					});
					sim.finally(`request ${i}: a source nobody reads any more is cancelled`, () => {
						const ended =
							r.visitor === 'leaves' ||
							r.visitor === 'reads one, then cancels' ||
							r.shape === 'HEAD' ||
							r.shape === '304';
						if (
							r.shape !== 'no body' &&
							ended &&
							!read_to_end &&
							!source.cancelled() &&
							r.chunks > 1
						)
							return 'the page source was left uncancelled';
						return null;
					});
					sim.finally(`request ${i}: its work is let go once it ended`, () => {
						const ended = r.visitor !== 'reads nothing' || r.shape !== 'body';
						if (ended && fetch_signal !== null && !fetch_signal.aborted)
							return 'its fetch still holds';
						return null;
					});
				});
				await sim.play(steps);
			},
			{ runs: 1000 }
		);
	});
});
