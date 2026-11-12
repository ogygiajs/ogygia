// A REMOTE FUNCTION'S ARGUMENT IS PLAIN DATA. On the server, Kit decodes with the app's `transport`
// only what a browser sent: a remote function's argument and the refresh keys of a command. So the
// server's transport refuses every ogygia value kind there (a region, a snippet, a function, a wired
// class, a store, a derived store) with a 400 and a message code; plain data decodes as before. The
// browser still decodes every kind the server sends it.
import { isHttpError } from '@sveltejs/kit';
import * as devalue from 'devalue';
import { describe, expect, it } from 'vitest';
import { ogygiaServerTransport as server_transport } from '../src/server/transport.ts';

type Codec = { encode: (v: unknown) => unknown; decode: (v: never) => unknown };
const decoders = (t: Record<string, Codec>) =>
	Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.decode])) as Record<
		string,
		(v: unknown) => unknown
	>;

/** A remote argument as a browser would send it: `value`, with `{ wire: [key, payload] }` objects
 *  standing for a value the browser's transport encoded under `key`. */
function sent(value: unknown): string {
	const under = (key: string) => (v: unknown) => {
		const wire = (v as { wire?: [string, unknown] } | null)?.wire;
		return wire?.[0] === key && wire[1];
	};
	return devalue.stringify(value, { Region: under('Region'), OgygiaRef: under('OgygiaRef') });
}

/** How the server reads it (Kit's `parse_remote_arg`: devalue with the transport's decoders). */
const read = (json: string) => devalue.parse(json, decoders(server_transport as never));

function refusal(json: string): { status: number; message: string } {
	try {
		read(json);
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, message: e.body.message };
		throw e;
	}
	throw new Error('decoded');
}

const REF_KINDS: [string, unknown][] = [
	['fn', { k: 'fn', i: 'f1', t: 'tag', d: { b: [] } }],
	['snippet', { k: 'snippet', i: 's1', d: { m: 'static', h: '<p>x</p>' } }],
	['wire', { k: 'wire', i: 'w1', t: 'Cart', d: {} }],
	['store', { k: 'store', i: 'st1', d: 1 }],
	['derived', { k: 'derived', i: 'd1', d: {} }],
	['region', { k: 'region', i: 'r1', d: { i: 'x', p: {}, u: '', m: '', x: '<p>x</p>' } }]
];

describe('a remote argument sent from the browser', () => {
	for (const [kind, ref] of REF_KINDS)
		it(`carrying a ${kind} is refused with a 400 and a message code`, () => {
			const r = refusal(sent({ a: 1, value: { wire: ['OgygiaRef', ref] } }));
			expect(r.status).toBe(400);
			expect(r.message).toContain('remote_arg_not_data');
		});

	it('carrying a region ticket is refused with a 400 and a message code', () => {
		const ticket = { i: 'x', p: {}, u: '/__ogygia__?id=x', m: '', x: '<p>x</p>' };
		const r = refusal(sent([{ wire: ['Region', ticket] }]));
		expect(r.status).toBe(400);
		expect(r.message).toContain('remote_arg_not_data');
	});

	it('of plain data decodes as before', () => {
		const arg = { id: 7, tags: ['a', 'b'], at: new Date(0), m: new Map([['k', 1]]), n: null };
		expect(read(sent(arg))).toEqual(arg);
	});
});
