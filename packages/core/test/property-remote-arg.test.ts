// A remote function's argument is plain data, over generated arguments rather than picked ones
// (server/transport.ts). Whatever a browser nests, and whatever it puts under ogygia's transport
// names, the server's decode either gives back plain data or refuses with a 400 and
// `remote_arg_not_data`; it never revives an ogygia value, throws anything else, or touches
// Object.prototype.
import { isHttpError } from '@sveltejs/kit';
import * as devalue from 'devalue';
import { expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { ogygiaServerTransport as server_transport } from '../src/server/transport.ts';

const decoders = Object.fromEntries(
	Object.entries(server_transport).map(([k, v]) => [k, v.decode])
) as Record<string, (v: unknown) => unknown>;

/** The prototypes plain data may have once decoded: what devalue itself revives. */
const PLAIN: ReadonlySet<unknown> = new Set([
	null,
	Object.prototype,
	Array.prototype,
	Date.prototype,
	Map.prototype,
	Set.prototype,
	RegExp.prototype,
	URL.prototype,
	URLSearchParams.prototype,
	ArrayBuffer.prototype,
	...[
		Int8Array,
		Uint8Array,
		Uint8ClampedArray,
		Int16Array,
		Uint16Array,
		Int32Array,
		Uint32Array,
		Float32Array,
		Float64Array,
		BigInt64Array,
		BigUint64Array
	].map((t) => t.prototype)
]);

function plain(x: unknown, seen = new Set<unknown>()): void {
	if (x === null || typeof x !== 'object' || seen.has(x)) return;
	seen.add(x);
	expect(PLAIN.has(Object.getPrototypeOf(x))).toBe(true);
	const kids = x instanceof Map ? [...x.keys(), ...x.values()] : x instanceof Set ? [...x] : [];
	for (const k of [...kids, ...Object.values(x)]) plain(k, seen);
}

/** What a browser could put under one of ogygia's transport names: refs of every kind and none. */
const payload = fc.oneof(
	fc.record(
		{
			k: fc.oneof(
				fc.constantFrom('fn', 'snippet', 'wire', 'store', 'derived', 'region', '__proto__'),
				fc.anything()
			),
			i: fc.anything(),
			t: fc.anything(),
			d: fc.anything()
		},
		{ requiredKeys: [] }
	),
	fc.object(),
	fc.array(fc.anything(), { minLength: 1 })
);

/** An argument: any data, with values sent under ogygia's transport names anywhere in it. */
const { arg } = fc.letrec((tie) => ({
	arg: fc.oneof(
		{ depthSize: 'small' },
		fc.anything({ withDate: true, withMap: true, withSet: true, withBigInt: true }),
		fc.record({ wire: fc.tuple(fc.constantFrom('Region', 'OgygiaRef'), payload) }),
		fc.array(tie('arg'), { maxLength: 4 }),
		fc.dictionary(fc.string({ maxLength: 4 }), tie('arg'), { maxKeys: 4 })
	)
}));

const under = (key: string) => (v: unknown) => {
	const wire = (v as { wire?: [string, unknown] } | null)?.wire;
	return Array.isArray(wire) && wire[0] === key && wire[1];
};

it('any argument a browser sends decodes to plain data or is refused with remote_arg_not_data', () => {
	let refused = 0;
	fc.assert(
		fc.property(arg, (value) => {
			const json = devalue.stringify(value, {
				Region: under('Region'),
				OgygiaRef: under('OgygiaRef')
			});
			let out: unknown;
			try {
				out = devalue.parse(json, decoders);
			} catch (e) {
				expect(isHttpError(e), String(e)).toBe(true);
				if (!isHttpError(e)) return;
				expect(e.status).toBe(400);
				expect(e.body.message).toContain('remote_arg_not_data');
				refused++;
				return;
			}
			plain(out);
			expect(Object.keys(Object.prototype)).toEqual([]);
		}),
		{ numRuns: 400 }
	);
	expect(refused, 'some arguments carried an ogygia value').toBeGreaterThan(20);
});
