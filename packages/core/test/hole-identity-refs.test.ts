/**
 * A HOLE'S IDENTITY IS THE SAME ON BOTH LEGS (#816). On a Kit-hydrated document the browser leg of
 * Region computes a hole's identity (`data-og-hole`) again, to find the facts the server minted for
 * it when Kit mounts the hole afresh. When the hole's props hold a stateful ref (a wired instance, a
 * store), the server names the ref by its request's place and the browser by an id of its own: the
 * two must still give one identity.
 */
import { describe, expect, it } from 'vitest';
import { ref_names, set_ref_names_reader } from '../src/ref.ts';
import { __register_transportable, wire } from '../src/live-transport.ts';
import { hole_identity } from '../src/server/props-wire.ts';

class Badge {
	label: string;
	constructor(label = '') {
		this.label = label;
	}
	static [wire] = {
		encode: (b: Badge) => b.label,
		decode: (label: string) => new Badge(label)
	};
}
__register_transportable('src/badge.ts#Badge', Badge);

const ENTRY = '/holes/account.js';

/** The server leg: one request's names, and something minted before the hole (the page's islands). */
function server_leg(props: () => Record<string, unknown>): string {
	const names = ref_names();
	set_ref_names_reader(() => names);
	try {
		hole_identity(ENTRY, { earlier: new Badge('island') });
		return hole_identity(ENTRY, props());
	} finally {
		set_ref_names_reader(null);
	}
}

describe('hole identity across the two legs', () => {
	it('a hole whose props hold a wired instance has one identity on the server and in the browser', () => {
		const props = () => ({ who: new Badge('signed-in'), n: 1 });
		const server = server_leg(props);
		const browser = hole_identity(ENTRY, props()); // (the browser: no request names)
		expect(browser).toBe(server);
	});

	it('one instance held twice is not the same hole as two equal instances', () => {
		const one = new Badge('x');
		const shared = hole_identity(ENTRY, { a: one, b: one });
		const separate = hole_identity(ENTRY, { a: new Badge('x'), b: new Badge('x') });
		expect(shared).not.toBe(separate);
	});

	it('different props give different identities', () => {
		expect(hole_identity(ENTRY, { who: new Badge('a') })).not.toBe(
			hole_identity(ENTRY, { who: new Badge('b') })
		);
	});
});
