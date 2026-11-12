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

/** Send `value` as a browser would and decode it as the server does: plain data, or a refusal. */
function decode(value: unknown): 'plain' | 'refused' {
	let json: string;
	try {
		json = devalue.stringify(value, {
			Region: under('Region'),
			OgygiaRef: under('OgygiaRef')
		});
	} catch (e) {
		// (devalue sends no `__proto__` key, so a browser's call never carries one: not an argument)
		if (e instanceof devalue.DevalueError && e.message.includes('__proto__')) fc.pre(false);
		throw e;
	}
	let out: unknown;
	try {
		out = devalue.parse(json, decoders);
	} catch (e) {
		expect(isHttpError(e), String(e)).toBe(true);
		if (!isHttpError(e)) return 'refused';
		expect(e.status).toBe(400);
		expect(e.body.message).toContain('remote_arg_not_data');
		return 'refused';
	}
	plain(out);
	expect(Object.keys(Object.prototype)).toEqual([]);
	return 'plain';
}

it('any argument a browser sends decodes to plain data or is refused with remote_arg_not_data', () => {
	let refused = 0;
	fc.assert(
		fc.property(arg, (value) => {
			if (decode(value) === 'refused') refused++;
		}),
		{ numRuns: 400 }
	);
	expect(refused, 'some arguments carried an ogygia value').toBeGreaterThan(20);
});

/** Which cycles to tie into an argument: devalue sends a repeated or cyclic reference as one. */
const ties = fc.record({
	self: fc.boolean(),
	in_array: fc.boolean(),
	in_map: fc.boolean(),
	in_set: fc.boolean(),
	/** an ogygia value whose payload reaches back to the argument around it */
	through_ref: fc.option(fc.constantFrom('Region', 'OgygiaRef'), { nil: null }),
	shared: fc.boolean()
});

it('a cyclic or shared argument decodes to plain data or is refused, as a tree does', () => {
	let refused = 0;
	fc.assert(
		fc.property(arg, ties, (inner, t) => {
			const root: Record<string, unknown> = { inner };
			if (t.self) root.self = root;
			if (t.in_array) {
				const list: unknown[] = [root, inner];
				list.push(list);
				root.list = list;
			}
			if (t.in_map) root.map = new Map<unknown, unknown>([['back', root]]);
			if (t.in_set) root.set = new Set<unknown>([root]);
			if (t.through_ref) root.ref = { wire: [t.through_ref, { k: 'fn', d: root }] };
			if (t.shared) root.again = [inner, inner];
			const result = decode(root);
			if (t.through_ref) expect(result).toBe('refused');
			if (result === 'refused') refused++;
		}),
		{ numRuns: 300 }
	);
	expect(refused, 'some arguments carried an ogygia value').toBeGreaterThan(20);
});

it('an ogygia value deep in a nested argument is refused', () => {
	fc.assert(
		fc.property(
			fc.integer({ min: 1, max: 200 }),
			fc.constantFrom('Region', 'OgygiaRef'),
			fc.constantFrom('array', 'object', 'map'),
			(depth, kind, shape) => {
				let value: unknown = { wire: [kind, { k: 'snippet' }] };
				for (let i = 0; i < depth; i++) {
					value =
						shape === 'array' ? [value] : shape === 'map' ? new Map([[i, value]]) : { v: value };
				}
				expect(decode(value)).toBe('refused');
			}
		),
		{ numRuns: 100 }
	);
});
