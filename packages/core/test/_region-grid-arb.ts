// The region fuzz's inputs: a grid case (any kind, any value on each axis), at any place, with raw
// values over the props it writes as text (hazard strings: quotes, `>`, entities, markup, unicode)
// and props of any JSON shape, plus props its kind never reads. Plain data, so a failure prints a
// readable input and the hydration fuzz can hand the same input to its server leg.
import { fc, HAZARD_TEXTS, HAZARD_VALUES } from '@ogygia/config/html-fuzz';
import { FOREIGN, KINDS, MIXED, PLACES, type Place, type Spec } from './_region-grid.ts';

/** An attribute's text: a hazard, or any string. */
export const attr_text: fc.Arbitrary<string> = fc.oneof(
	fc.constantFrom(...HAZARD_VALUES, ...HAZARD_TEXTS),
	fc.string({ maxLength: 12 }),
	fc.string({ unit: 'grapheme', maxLength: 6 })
);

/** A module's URL: always a root-relative path (the compiler writes one; Kit's `resolve` refuses
 *  anything else), its text any. */
const module_url: fc.Arbitrary<string> = attr_text.map((t) => `/${t}`);

/** A props object of any JSON shape, its strings hazards too. */
const json_props: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
	fc
		.oneof(
			fc.constantFrom('a', 'b', 'class', '__proto_x', '</script>'),
			fc.string({ maxLength: 5 })
		)
		.filter((k) => k !== 'children'),
	fc.jsonValue({ maxDepth: 2 }),
	{ maxKeys: 4 }
);

/** Raw values over a kind's text props (each prop present or not). */
function raw_of(kind: string): fc.Arbitrary<Record<string, unknown>> {
	const ttl = fc.oneof(fc.constantFrom(0, -1, 1, 60, 1.5), fc.integer());
	const text = attr_text;
	switch (kind) {
		case 'island':
			return fc.record(
				{
					__entry: module_url,
					__keep: text,
					visible: text,
					media: text,
					__props: json_props,
					__cacheTtl: ttl
				},
				{ requiredKeys: [] }
			);
		case 'hole':
			return fc.record(
				{
					__entry: text,
					__defer: text,
					__hydrate: text,
					__module: fc.oneof(fc.constant(''), module_url),
					__margin: text,
					__hydrateMargin: text,
					__stitch: text,
					__prefetch: text,
					__cacheTtl: ttl,
					__props: json_props
				},
				{ requiredKeys: [] }
			);
		case 'lake':
			return fc.record(
				{
					__entry: text,
					__remount: fc.oneof(fc.constantFrom('cache', 'empty', 'swr'), text),
					__when: text,
					__maxAge: ttl,
					__onExpire: fc.oneof(fc.constantFrom('empty', 'fetch'), text),
					__margin: text,
					__props: json_props
				},
				{ requiredKeys: [] }
			);
	}
	return fc.constant({});
}

/** `t` as HTML text. */
const escape_text = (t: string) => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

/** Raw values over a held value's fields. A live value's `html` is the server's own render of a
 *  region (render_region_html): always well-formed, its text any. */
function of_raw_of(kind: string): fc.Arbitrary<Record<string, unknown>> {
	const text = attr_text;
	switch (kind) {
		case 'dual':
			return fc.record(
				{
					id: text,
					module: fc.oneof(fc.constant(''), module_url),
					hydrate: text,
					hydrateMargin: text,
					props: json_props
				},
				{ requiredKeys: [] }
			);
		case 'deferred':
			return fc.record(
				{
					id: text,
					url: text,
					module: fc.oneof(fc.constant(''), module_url),
					hydrate: text,
					hydrateMargin: text,
					props: json_props,
					html: fc.oneof(
						fc.constantFrom('', 'plain', '<b>live</b>', '<p>a</p><p>b</p>', '<!--c-->'),
						attr_text.map((t) => `<b>${escape_text(t)}</b>`)
					)
				},
				{ requiredKeys: [] }
			);
		case 'inline':
			return fc.record({ props: json_props, content_id: text }, { requiredKeys: [] });
	}
	return fc.constant({});
}

/** One fuzz input of `kind`; with `stray`, props it never reads (`foreign`) or reads though never
 *  given (`mixed`). */
export function spec_arb(stray: 'none' | 'foreign' | 'mixed', raw = true): fc.Arbitrary<Spec> {
	return fc.constantFrom(...Object.keys(KINDS)).chain((kind) =>
		fc.record({
			kind: fc.constant(kind),
			values: fc.record(
				Object.fromEntries(
					Object.entries(KINDS[kind].axes).map(([a, vs]) => [a, fc.constantFrom(...vs)])
				) as Record<string, fc.Arbitrary<string>>
			),
			raw: raw ? raw_of(kind) : fc.constant({}),
			of_raw: raw ? of_raw_of(kind) : fc.constant({}),
			stray:
				stray === 'none'
					? fc.constant([])
					: fc.subarray([...(stray === 'foreign' ? FOREIGN[kind] : MIXED)], { minLength: 1 })
		})
	);
}

export const place_arb: fc.Arbitrary<Place> = fc.constantFrom(...PLACES);
