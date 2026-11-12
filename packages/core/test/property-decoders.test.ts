// Properties of the decoders that read what a server wrote (INVARIANTS HOLE-TRUST, PAGE-SEED), over
// generated inputs rather than picked ones:
// - a batch stream's parcels read back as written, however the stream is cut into chunks, and any
//   text at all is read without a throw, a hang or a step backwards;
// - an island's props read back as the same data in both lanes, and their wire text has no `<`
//   (nothing in it can end its script);
// - a foreign sidecar's text, whatever it holds, parses or throws an Error, and never revives a
//   wired class or touches Object.prototype;
// - the island graph reads back as written, and any text decodes to a graph (empty when not one).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { read_parcel } from '../src/runtime/frame-nav.ts';
import { build_parcel, done_parcel } from '../src/server/stream-regions.ts';
import { plan_props_wire } from '../src/server/props-wire.ts';
import { parse_wire_text } from '../src/runtime/wire-format.ts';
import { link_boot } from '../src/runtime/boot-link.ts';
import { load_devalue } from '../src/runtime/devalue-lane.ts';
import { foreign_region_prop_revivers } from '../src/runtime/foreign-props.ts';
import {
	decode_island_graph,
	decode_island_locations,
	encode_island_graph
} from '../src/island-graph.ts';

link_boot();
await load_devalue();

/** Every run draws the same inputs (314, as the sim, unless `OGYGIA_SIM_SEED` says): an input that
 *  fails, fails on every run, and the seed in its report replays it (#994). */
const SEED = Number(process.env.OGYGIA_SIM_SEED ?? 314);

/** Every parcel whole in `buf`, and the text after the last one. */
function read_all(buf: string) {
	const out: { slot: string; html: string }[] = [];
	let at = 0;
	for (let p = read_parcel(buf, 0); p; p = read_parcel(buf, at)) {
		expect(p.end).toBeGreaterThan(at);
		expect(p.end).toBeLessThanOrEqual(buf.length);
		out.push({ slot: p.slot, html: p.html });
		at = p.end;
	}
	return { out, rest: buf.slice(at) };
}

/** Text built from the pieces a parcel reader looks for, and some that are near them. */
const parcel_text = fc
	.array(
		fc.oneof(
			fc.constantFrom(
				'</template>',
				'</TEMPLATE>',
				'</template',
				'<template data-ogygia-slot="',
				'" data-og-len="',
				'">',
				'"',
				'7',
				'<',
				'</',
				'ü',
				'🎉'
			),
			fc.string({ maxLength: 6 })
		),
		{ maxLength: 24 }
	)
	.map((parts) => parts.join(''));
const slot = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);

describe('batch stream parcels', () => {
	it('read back as written, at any chunk cuts', () => {
		fc.assert(
			fc.property(
				fc.array(fc.record({ slot, html: parcel_text }), { maxLength: 5 }),
				fc.array(fc.nat(), { maxLength: 6 }),
				(parcels, cuts) => {
					const stream = `${parcels.map((p) => build_parcel(p.slot, p.html)).join('')}${done_parcel()}`;
					const at = [...new Set(cuts.map((c) => c % (stream.length + 1)))].sort((a, b) => a - b);
					const got: { slot: string; html: string }[] = [];
					let buffer = '';
					let from = 0;
					for (const cut of [...at, stream.length]) {
						buffer += stream.slice(from, cut);
						from = cut;
						const { out, rest } = read_all(buffer);
						got.push(...out);
						buffer = rest;
					}
					expect(got).toEqual([...parcels, { slot: '__ogygia_done__', html: '' }]);
				}
			),
			{ seed: SEED, numRuns: 500 }
		);
	});

	it('any text is read without a throw, and each parcel moves forward', () => {
		fc.assert(
			fc.property(parcel_text, (text) => {
				read_all(text);
			}),
			{ seed: SEED, numRuns: 1000 }
		);
	});

	it('a stream of many openings the server never writes is read without running out of stack (#835)', () => {
		const text = '<template data-ogygia-slot="x"y'.repeat(50_000);
		expect(read_all(text).out).toEqual([]);
	});
});

/** Values an island's props can hold, in both lanes. */
const leaf = fc.oneof(
	fc.string(),
	fc.constantFrom('</script>', '<!--', '<script>', '\u2028', '</SCRIPT '),
	fc.integer(),
	fc.double(),
	fc.boolean(),
	fc.constant(null),
	fc.constant(undefined),
	fc.date({ noInvalidDate: true }),
	fc.bigInt()
);
const key = fc.string().filter((k) => k !== '__proto__');
const prop_value = fc.letrec((tie) => ({
	value: fc.oneof(
		{ depthSize: 'small' },
		leaf,
		fc.array(tie('value'), { maxLength: 4 }),
		fc.dictionary(key, tie('value'), { maxKeys: 4 })
	)
})).value;
const props = fc.dictionary(key, prop_value, { maxKeys: 5 });
const json_props = fc.dictionary(key, fc.jsonValue(), { maxKeys: 5 });

describe('island props', () => {
	it('read back as the same data in either lane, and their text has no <', () => {
		fc.assert(
			fc.property(fc.oneof(props, json_props), (value) => {
				const w = plan_props_wire(value, 'entry.svelte').wire(null);
				expect(w.text).not.toContain('<');
				expect(parse_wire_text(w.text, w.json)).toEqual(value);
			}),
			{ seed: SEED, numRuns: 500 }
		);
	});

	it('a foreign sidecar parses or throws an Error, never revives a class, never touches Object.prototype', () => {
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		const text = fc.oneof(
			fc.string(),
			fc.json(),
			fc
				.array(
					fc.oneof(
						fc.constantFrom(
							'[',
							']',
							'{',
							'}',
							',',
							':',
							'"__proto__"',
							'"OgygiaRef"',
							'"constructor"',
							'-1',
							'0',
							'1',
							'2',
							'"x"'
						),
						fc.nat(9).map(String)
					),
					{ maxLength: 20 }
				)
				.map((parts) => parts.join(''))
		);
		fc.assert(
			fc.property(text, fc.boolean(), (t, json) => {
				try {
					parse_wire_text(t, json, foreign_region_prop_revivers());
				} catch (e) {
					expect(e).toBeInstanceOf(Error);
				}
				expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
			}),
			{ seed: SEED, numRuns: 2000 }
		);
	});
});

describe('island graph', () => {
	const href = fc.string({ minLength: 1, maxLength: 12 });
	it('reads back as written', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(href, fc.array(href, { maxLength: 4 })), { maxLength: 6 }),
				fc.array(fc.tuple(href, href), { maxLength: 4 }),
				(entries, locs) => {
					const graph = new Map(entries);
					const locations = new Map(locs);
					const text = encode_island_graph(graph, locations);
					expect(decode_island_graph(text)).toEqual(graph);
					expect(decode_island_locations(text)).toEqual(locations);
				}
			),
			{
				seed: SEED,
				numRuns: 500,
				// (names an object has already, which a plain-object table would lose or mix up: #994)
				examples: [
					[[['__proto__', ['a']]], [['__proto__', 'b']]],
					[
						[
							['constructor', []],
							['toString', ['c']]
						],
						[['hasOwnProperty', 'd']]
					]
				]
			}
		);
	});

	it('any text decodes to a graph of strings, without a throw', () => {
		fc.assert(
			fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
				for (const [k, v] of decode_island_graph(text)) {
					expect(typeof k).toBe('string');
					for (const h of v) expect(typeof h).toBe('string');
				}
				for (const [k, v] of decode_island_locations(text)) {
					expect(typeof k).toBe('string');
					expect(typeof v).toBe('string');
				}
			}),
			{ seed: SEED, numRuns: 1000 }
		);
	});
});
