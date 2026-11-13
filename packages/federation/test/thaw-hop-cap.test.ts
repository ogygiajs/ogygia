/**
 * A thaw notice is passed on peer to peer with `hop + 1`, and stops at the hop cap (4): the last
 * hop under the cap is still sent, the one at the cap is not, so a ring of peers cannot loop.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcast_thaw, current_federation, federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';

afterEach(() => {
	vi.unstubAllGlobals();
	set_federation(null);
});

/** an outbox stand-in that takes every notice and keeps each one's hop */
function box(): { hops: number[]; put: (t: { body: ArrayBuffer }) => Promise<boolean> } {
	const hops: number[] = [];
	return {
		hops,
		put: async (t) => {
			hops.push(JSON.parse(new TextDecoder().decode(t.body)).hop);
			return true;
		}
	};
}

describe('the thaw hop cap', () => {
	it('hop 3 is still passed on; hop 4 is not', async () => {
		vi.stubGlobal('fetch', async () => new Response('{}'));
		federate({ name: 'shell', peers: { cms: { origin: 'http://cms.test' } } });
		const fed = current_federation()!;
		const b = box();
		const below = await broadcast_thaw(
			fed,
			{ id: 'n1', hop: 3, tags: ['s:a'] },
			undefined,
			b as never
		);
		const at = await broadcast_thaw(
			fed,
			{ id: 'n2', hop: 4, tags: ['s:a'] },
			undefined,
			b as never
		);
		expect(b.hops).toEqual([3]);
		expect([...below, ...at]).toEqual([]);
	});
});
