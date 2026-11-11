// SIMULATION of a thaw notice arriving (src/serve.ts serve_thaw): copies of two notices come in
// any order (the sender's retries, a copy while the first still applies, one after), and the
// store applies or fails each evict when the scheduler says:
// - done means done: a peer answers ok for a notice only once its store applied it (#287);
// - no doubled side effect: one apply of a notice out at once, and once applied, a copy of it is
//   dropped, never applied again;
// - a failed apply keeps nothing: a later copy, with the store up, is applied;
// - a notice is passed on to this app's consumers only once applied;
// - the server's rules, and every delivery is answered.
import { afterEach, describe, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { fc, simulate } from '@ogygia/config/sim';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { federate } from '../src/federate.ts';
import { sign_headers, THAW_PATH } from '../src/wire.ts';
import { set_federation } from '../src/registry.ts';
import { serve_federation } from '../src/serve.ts';
import fed_server from '../src/server.ts';
import { register_hooks } from '../../core/src/plugin/hooks.ts';
import { server_rules_hold } from '../../core/test/sim/_server.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const cms_pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const cms_priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

/** A copy of a notice as the sender posts it: signed afresh (a byte-identical replay is refused). */
function delivery(notice: { id: string; hop: number; tags: string[] }): RequestEvent {
	const url = new URL(THAW_PATH, 'http://shell.test');
	const bytes = new TextEncoder().encode(JSON.stringify({ ...notice, from: 'cms' }));
	const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	const headers = {
		'content-type': 'application/json',
		...sign_headers(cms_priv, 'POST', url, body as ArrayBuffer)
	};
	return {
		url,
		request: new Request(url, { method: 'POST', headers, body }),
		cookies: { get: () => undefined },
		locals: {}
	} as unknown as RequestEvent;
}

afterEach(() => {
	vi.restoreAllMocks();
	set_federation(null);
});

let run = 0;

describe('a thaw notice arriving, simulated', () => {
	it('is answered done only once applied, applied once, and passed on only then', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await simulate.check(
			[
				fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
				fc.array(fc.constantFrom('n1', 'n2'), { minLength: 1, maxLength: 6 })
			],
			async (sim, store_fails, copies) => {
				server_rules_hold(sim);
				run++;
				const ids = { n1: `run${run}-n1`, n2: `run${run}-n2` };
				const tags = { n1: ['s:doc:1'], n2: ['s:doc:2'] };
				/** the consumers this app passes notices on to */
				const forwarded: string[] = [];
				sim.fetch(async (request) => {
					const notice = (await request.json()) as { id: string };
					forwarded.push(notice.id);
					return Response.json({ ok: true });
				});
				federate({
					name: 'shell',
					audience: 'shell.test',
					peers: {
						cms: { origin: 'http://cms.test', key: cms_pub },
						dash: { origin: 'http://dash.test' }
					}
				});
				type Apply = { id: string; ended: boolean; ok: boolean };
				const applies: Apply[] = [];
				let n = 0;
				const off = register_hooks({
					invalidate(local: string[]) {
						const which = local[0] === 'r:cms:s:doc:1' ? 'n1' : 'n2';
						const a: Apply = { id: which, ended: false, ok: false };
						applies.push(a);
						const fails = store_fails[n++ % store_fails.length];
						return sim.later(`the store ${fails ? 'fails' : 'applies'} ${which}`, () => {
							a.ended = true;
							if (fails) throw new Error('store down');
							a.ok = true;
						});
					}
				});
				const answered: Array<{ id: 'n1' | 'n2'; ok: boolean; applied_then: boolean }> = [];

				sim.always('done means done: ok only once applied (#287)', () => {
					const bad = answered.find((a) => a.ok && !a.applied_then);
					return bad ? `${bad.id} answered ok before its store applied it` : null;
				});
				sim.always(
					'no doubled side effect: one apply of a notice out, none after it is applied',
					() => {
						for (const id of ['n1', 'n2'] as const) {
							const mine = applies.filter((a) => a.id === id);
							if (mine.filter((a) => !a.ended).length > 1) return `two applies of ${id} out`;
							const first_ok = mine.findIndex((a) => a.ok);
							if (first_ok !== -1 && mine.length > first_ok + 1)
								return `${id} applied again after it was`;
						}
						return null;
					}
				);
				sim.always('passed on only once applied', () => {
					for (const id of ['n1', 'n2'] as const)
						if (forwarded.includes(ids[id]) && !applies.some((a) => a.id === id && a.ok))
							return `${id} passed on, never applied`;
					return null;
				});
				sim.finally('every notice that arrived was let in (its signature verified)', () => {
					for (const id of new Set(copies))
						if (!applies.some((a) => a.id === id)) return `${id} never reached the store`;
					return null;
				});
				sim.finally(
					'a failed apply keeps nothing: a later copy with the store up is applied',
					() => {
						for (const id of ['n1', 'n2'] as const) {
							const mine = applies.filter((a) => a.id === id);
							const last = answered.filter((a) => a.id === id).at(-1);
							if (last?.ok === false && mine.some((a) => a.ok))
								return `${id} applied, yet its last copy failed`;
						}
						return null;
					}
				);
				try {
					await sim.play(
						copies.map((id) => [
							`a copy of ${id} arrives`,
							() =>
								serve_federation(delivery({ id: ids[id], hop: 0, tags: tags[id] })).then((res) =>
									answered.push({
										id,
										ok: res!.ok,
										applied_then: applies.some((a) => a.id === id && a.ok)
									})
								)
						])
					);
				} finally {
					off();
					set_federation(null);
				}
			},
			{ runs: 500 }
		);
	});
});
