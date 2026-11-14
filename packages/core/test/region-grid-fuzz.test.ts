// THE REGION FUZZ (server leg): the grid's inputs (test/_region-grid-arb.ts) with raw text over
// every prop Region writes as text, props of any JSON shape, and props a kind never reads, at any
// place, in dev and production. Seeded (314, or OGYGIA_FUZZ_SEED), so CI tries the same inputs
// every run and a failure replays; OGYGIA_FUZZ_RUNS sets how many each property tries.
import './_region-grid-devtools.ts';
import { afterEach, expect, test, vi } from 'vitest';
import { parse as devalue_parse } from 'devalue';
import { elements, fuzz, fc, parse_document } from '@ogygia/config/html-fuzz';
import { spec_case, spec_props, rejected_code, type Place, type Spec } from './_region-grid.ts';
import { place_arb, spec_arb } from './_region-grid-arb.ts';
import { server_out } from './_region-grid-server.ts';
import { html_findings, unbalanced_markers } from './_region-grid-checks.ts';

const RUNS = 2000;
/** A property's time: its runs, however many OGYGIA_FUZZ_RUNS asks for (the nightly run's many). */
const LONG = 3_600_000;
const PLAIN: Place = { at: 'page', kit: 'none', csr: 'off', page: 'ok', env: 'prod' };

afterEach(() => {
	vi.unstubAllEnvs();
});

const render = (s: Spec, place: Place, stray = true, devtools = true) => {
	vi.stubEnv('DEV', place.env === 'dev');
	return server_out(spec_case(s), place, () => [spec_props(s, stray)], devtools);
};

test(
	'any input, mixed props too, renders good HTML with its markers balanced, and throws only a coded refusal',
	() => {
		fuzz(
			fc.tuple(spec_arb('mixed'), place_arb),
			([s, place]) => {
				const out = render(s, place);
				if (out.thrown) expect(rejected_code(out.thrown), out.thrown).not.toBeNull();
				expect(unbalanced_markers(out.body)).toEqual([]);
				expect(unbalanced_markers(out.head)).toEqual([]);
				expect(html_findings(out.head, out.body, out.tail)).toEqual([]);
			},
			{ runs: RUNS }
		);
	},
	LONG
);

test(
	'a prop its kind does not read changes nothing',
	() => {
		fuzz(
			fc.tuple(spec_arb('foreign'), place_arb),
			([s, place]) => {
				expect(render(s, place, true).text).toBe(render(s, place, false).text);
			},
			{ runs: RUNS }
		);
	},
	LONG
);

test(
	'with devtools off, a render is the same, with no devtools events',
	() => {
		fuzz(
			fc.tuple(spec_arb('none'), place_arb),
			([s, place]) => {
				const on = render(s, place, true, true).text;
				const off = render(s, place, true, false).text;
				expect(off).toBe(on.replace(/<!-- devtools -->.*$/m, '<!-- devtools -->[]'));
			},
			{ runs: RUNS }
		);
	},
	LONG
);

/** The first region element in `html`, its attributes as the DOM holds them. */
function first_region(html: string): Map<string, string> | undefined {
	return elements(parse_document(html)).find((e) => e.name === 'ogygia-region')?.attrs;
}

type Written = [
	prop: string,
	attr: string,
	when: (p: Record<string, unknown>) => boolean,
	otherwise?: string
];
/** Each attribute Region writes from a prop's text, by kind: the prop, the attribute, when the
 *  attribute is written (else it is absent), and its text when the prop is not given. */
const WRITTEN: Record<string, Written[]> = {
	island: [
		['__keep', 'data-ogygia-keep', (p) => !!p.__keep],
		['visible', 'margin', (p) => typeof p.visible === 'string' && p.visible !== '']
	],
	hole: [
		['__stitch', 'stitch', (p) => !!p.__stitch],
		['__prefetch', 'prefetch', (p) => !!p.__prefetch],
		['__defer', 'when', () => true, 'load'],
		['__hydrate', 'wake', (p) => !!p.__hydrate],
		['__margin', 'margin', (p) => !!p.__margin],
		['__hydrateMargin', 'hydrate-margin', (p) => !!p.__hydrateMargin]
	],
	lake: [
		['__remount', 'remount', () => true, 'cache'],
		['__when', 'when', (p) => p.__remount === 'swr', 'load'],
		['__maxAge', 'max-age', (p) => p.__maxAge != null],
		['__onExpire', 'on-expire', (p) => !!p.__onExpire],
		['__margin', 'margin', (p) => p.__remount === 'swr' && !!p.__margin]
	]
};

test(
	"each attribute Region writes from a prop's text holds that text, whatever characters it has",
	() => {
		fuzz(
			spec_arb('none').filter((s) => s.kind in WRITTEN),
			(s) => {
				const place: Place = { ...PLAIN, at: s.kind === 'lake' ? 'island' : 'page' };
				const props = spec_props(s);
				const out = render(s, place);
				expect(out.thrown).toBeNull();
				const attrs = first_region(out.body)!;
				for (const [prop, attr, when, otherwise] of WRITTEN[s.kind]) {
					const value = props[prop] ?? otherwise;
					if (when(props)) expect([attr, attrs.get(attr)]).toEqual([attr, String(value)]);
					else expect([attr, attrs.has(attr)]).toEqual([attr, false]);
				}
				if (s.kind === 'island' && typeof props.media === 'string' && props.media)
					expect(attrs.get('wake')).toBe(props.media);
			},
			{ runs: RUNS }
		);
	},
	LONG
);

test(
	'the props sidecar beside a region reads back as its props, whatever they hold',
	() => {
		fuzz(
			spec_arb('none').filter(
				(s) =>
					(s.kind === 'island' && s.values.children === 'none' && s.values.component !== 'late') ||
					(s.kind === 'hole' && typeof s.raw.__hydrate === 'string' && s.raw.__hydrate !== '')
			),
			(s) => {
				const props = spec_props(s);
				if (!('__props' in s.raw)) return;
				const out = render(s, PLAIN);
				expect(out.thrown).toBeNull();
				const sidecars = elements(parse_document(out.body)).filter(
					(e) =>
						e.name === 'script' &&
						e.attrs.get('type') === 'application/ogygia-props' &&
						!e.ancestors.includes('ogygia-region')
				);
				expect(sidecars).toHaveLength(1);
				const [script] = sidecars;
				const json = script.attrs.get('data-og-format') === 'json';
				const read = json ? JSON.parse(script.text) : devalue_parse(script.text);
				expect(read).toEqual(json ? JSON.parse(JSON.stringify(props.__props)) : props.__props);
			},
			{ runs: RUNS }
		);
	},
	LONG
);
