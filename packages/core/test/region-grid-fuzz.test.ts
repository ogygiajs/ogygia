// THE REGION FUZZ (server leg): the grid's inputs (test/_region-grid-arb.ts) with raw text over
// every prop Region writes as text, props of any JSON shape, and props a kind never reads, at any
// place, in dev and production. Seeded (314, or OGYGIA_FUZZ_SEED), so CI tries the same inputs
// every run and a failure replays; OGYGIA_FUZZ_RUNS sets how many each property tries.
import './_region-grid-devtools.ts';
import { afterEach, expect, test, vi } from 'vitest';
import { parse as devalue_parse } from 'devalue';
import { elements, fuzz, fc, parse_document } from '@ogygia/config/html-fuzz';
import {
	spec_case,
	spec_props,
	settings_of,
	rejected_code,
	type Place,
	type Spec
} from './_region-grid.ts';
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

/** A render with devtools off is the one with devtools on, less its devtools events. */
function same_without_devtools(s: Spec, place: Place): void {
	const on = render(s, place, true, true).text;
	const off = render(s, place, true, false).text;
	expect(off).toBe(on.replace(/<!-- devtools -->.*$/m, '<!-- devtools -->[]'));
}

test(
	'with devtools off, a render is the same, with no devtools events',
	() => {
		fuzz(fc.tuple(spec_arb('none'), place_arb), ([s, place]) => same_without_devtools(s, place), {
			runs: RUNS
		});
	},
	LONG
);

test('with devtools off, a render whose devtools events hold a line separator is the same, with none (seed 314, path 42538:1:0:0:0:0:2:0:0:14:14:14:14:14:14)', () => {
	same_without_devtools(
		{
			kind: 'lake',
			values: {
				remount: 'cache',
				when: 'none',
				max_age: 'none',
				on_expire: 'none',
				margin: 'none',
				children: 'none',
				props: 'absent'
			},
			raw: { 'og.entry': ' ' },
			of_raw: {},
			stray: []
		} as unknown as Spec,
		{ at: 'woken-answer', kit: 'pass', csr: 'off', page: 'ok', env: 'prod' }
	);
});

/** The first region element in `html`, its attributes as the DOM holds them. */
function first_region(html: string): Map<string, string> | undefined {
	return elements(parse_document(html)).find((e) => e.name === 'ogygia-region')?.attrs;
}

type Written = [
	prop: string,
	attr: string,
	when: (p: Record<string, unknown>) => boolean,
	otherwise?: string,
	empty_is_otherwise?: boolean
];
/** Each attribute Region writes from a prop's text, by kind: the prop, the attribute, when the
 *  attribute is written (else it is absent), its text when the prop is not given, and whether an
 *  empty prop reads as not given (a hole's empty schedule is `load`, #1954). */
const WRITTEN: Record<string, Written[]> = {
	island: [
		['keep', 'data-ogygia-keep', (p) => !!p.keep],
		['wakeMargin', 'margin', (p) => !!p.wakeMargin]
	],
	hole: [
		['stitch', 'stitch', (p) => !!p.stitch],
		['prefetch', 'prefetch', (p) => !!p.prefetch],
		['when', 'when', () => true, 'load', true],
		['wake', 'wake', (p) => !!p.wake],
		['margin', 'margin', (p) => !!p.margin],
		['wakeMargin', 'hydrate-margin', (p) => !!p.wakeMargin]
	],
	lake: [
		['remount', 'remount', () => true, 'cache'],
		['when', 'when', (p) => p.remount === 'swr', 'load'],
		['maxAge', 'max-age', (p) => p.maxAge != null],
		['onExpire', 'on-expire', (p) => !!p.onExpire],
		['margin', 'margin', (p) => p.remount === 'swr' && !!p.margin]
	]
};

test(
	"each attribute Region writes from a prop's text holds that text, whatever characters it has",
	() => {
		fuzz(
			spec_arb('none').filter((s) => s.kind in WRITTEN),
			(s) => {
				const place: Place = { ...PLAIN, at: s.kind === 'lake' ? 'island' : 'page' };
				const props = settings_of(spec_props(s));
				const out = render(s, place);
				expect(out.thrown).toBeNull();
				const attrs = first_region(out.body)!;
				for (const [prop, attr, when, otherwise, empty_is_otherwise] of WRITTEN[s.kind]) {
					const value = (empty_is_otherwise ? props[prop] || undefined : props[prop]) ?? otherwise;
					if (when(props)) expect([attr, attrs.get(attr)]).toEqual([attr, String(value)]);
					else expect([attr, attrs.has(attr)]).toEqual([attr, false]);
				}
				if (s.kind === 'island' && typeof props.wake === 'string' && props.wake)
					expect(attrs.get('wake')).toBe(props.wake);
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
					(s.kind === 'hole' && typeof s.raw['og.wake'] === 'string' && s.raw['og.wake'] !== '')
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
