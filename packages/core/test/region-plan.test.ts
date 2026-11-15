import { expect, test } from 'vitest';
import { check, count, dead_fields, rows, table, type Row } from '@ogygia/machine/testing';
import {
	REGION,
	RegionPlans,
	region_input_key,
	region_kind,
	request_state,
	type RegionInputs,
	type RegionDecision
} from '../src/region-plan.ts';

type R = Row<RegionInputs, RegionDecision>;
const planned = (r: R): r is { input: RegionInputs; plan: RegionDecision } => 'plan' in r;
const ISLANDS = new Set(['island', 'dual-island']);
const HELD = new Set([
	'inline',
	'dual',
	'deferred',
	'live',
	'live-baked',
	'promise',
	'promise-bare'
]);

test('the table lists every input Region can be given, each with its plan or why no app gives it', async () => {
	expect(count(REGION)).toBe(9216);
	await expect(table(REGION)).toMatchFileSnapshot('__snapshots__/region-plan.md');
});

test('every row keeps the rules a region lives by', () => {
	const held = (r: R) => !planned(r) || !r.plan.nested || !r.plan.runtime;
	const checked = check(REGION, {
		'a refused row is a browser render under a Kit request, or a module on a region that is not a hole':
			(r) =>
				planned(r) ||
				(!r.input.server && (r.input.pass_mark || r.input.request !== 'none')) ||
				(r.input.module && r.input.kind !== 'hole'),
		'a top-level island on a csr=false page claims the runtime': (r) =>
			!planned(r) || !ISLANDS.has(r.input.kind) || r.plan.nested || r.plan.csr || r.plan.runtime,
		'a nested region claims no runtime': held,
		'a nested region asks for no page seed': (r) =>
			!planned(r) || !r.plan.nested || r.plan.seed === 'none',
		'the browser writes no head and asks for no seed': (r) =>
			!planned(r) || r.input.server || (r.plan.head === 'none' && r.plan.seed === 'none'),
		"only Kit's pass has a tail": (r) => !planned(r) || !r.plan.tail || r.plan.root === 'kit',
		'a region in a lake or below an ogygia root is never csr': (r) =>
			!planned(r) || !r.plan.csr || (!r.input.in_lake && r.plan.root !== 'ogygia'),
		'an inline region carries no wire of its own island': (r) =>
			!planned(r) || !r.plan.inline || r.plan.wire !== 'island',
		'a hole in a live snippet is never nested': (r) =>
			!planned(r) || r.input.kind !== 'hole' || !r.input.live_snippet || !r.plan.nested,
		'devtools hear only the server': (r) =>
			!planned(r) || r.input.server || r.plan.devtools === 'none',
		'a held value renders a held arm, a placed region its own': (r) =>
			!planned(r) ||
			HELD.has(r.input.kind) ===
				['inline', 'dual', 'deferred', 'live', 'live-baked', 'promise'].includes(r.plan.arm),
		'only a hole writes hole records': (r) =>
			!planned(r) ||
			r.input.kind === 'hole' ||
			(!r.plan.hole_tail && !r.plan.note_hole && !r.plan.early_hole && !r.plan.hole_graph),
		'a nested island hands its children over in its own render, so it marks nothing': (r) =>
			!planned(r) || !r.plan.nested || !r.plan.set_nested
	});
	expect(checked).toBe(9216);
});

test('every input field changes some plan', () => {
	expect(dead_fields(REGION)).toEqual([]);
});

test("a region's kind is its mode when placed, else what it holds now", () => {
	const held = (v: Record<string, unknown>) => v as never;
	expect(region_kind('island', held({ kind: 'inline' }), false, false, true)).toBe('island');
	expect(region_kind('server', undefined, false, false, false)).toBe('hole');
	expect(region_kind('lake', undefined, true, false, false)).toBe('lake');
	expect(region_kind(undefined, undefined, true, false, true)).toBe('promise');
	expect(region_kind(undefined, undefined, true, false, false)).toBe('promise-bare');
	expect(region_kind(undefined, undefined, false, true, true)).toBe('nothing');
	expect(region_kind(undefined, held({ kind: 'inline' }), false, false, false)).toBe('inline');
	expect(region_kind(undefined, held({ kind: 'dual' }), false, false, false)).toBe('dual');
	expect(region_kind(undefined, held({ kind: 'dual', hydrate: 'idle' }), false, false, false)).toBe(
		'dual-island'
	);
	expect(region_kind(undefined, held({ kind: 'deferred' }), false, true, false)).toBe('deferred');
	expect(region_kind(undefined, held({ kind: 'deferred', html: '' }), false, false, false)).toBe(
		'live'
	);
	expect(region_kind(undefined, held({ kind: 'deferred', html: '' }), false, true, false)).toBe(
		'live-baked'
	);
});

test("Kit's request context reads as none, a pass with no event yet, or an event", () => {
	expect(request_state(undefined)).toBe('none');
	expect(request_state({ event: undefined })).toBe('no-event');
	expect(request_state({ event: {} })).toBe('event');
});

test("every row has its own key, from 0 to one below the table's row count", () => {
	const keys = [...rows(REGION)].map((r) => region_input_key(r.input));
	expect(new Set(keys).size).toBe(9216);
	expect(Math.min(...keys)).toBe(0);
	expect(Math.max(...keys)).toBe(9215);
});

test('an input outside the lists has no key', () => {
	const input = [...rows(REGION)][0]!.input;
	expect(region_input_key({ ...input, kind: 'other' as never })).toBe(-1);
	expect(region_input_key({ ...input, request: 'other' as never })).toBe(-1);
	expect(region_input_key({ ...input, server: undefined as never })).toBe(-1);
});

test('the kept plans answer as the table does, the same plan for the same input', () => {
	const plans = new RegionPlans();
	for (const r of rows(REGION)) {
		if (!planned(r)) {
			expect(() => plans.decide(r.input)).toThrow(/machine_decision_refused/);
			expect(() => plans.decide(r.input)).toThrow(/machine_decision_refused/);
			continue;
		}
		const first = plans.decide({ ...r.input });
		expect(first).toEqual(r.plan);
		expect(plans.decide({ ...r.input })).toBe(first);
	}
});

test('a refused input throws a coded refusal that names it', () => {
	const input: RegionInputs = { ...[...rows(REGION)][0]!.input, kind: 'island', module: true };
	expect(() => REGION.decide(input)).toThrow(/ogygiajs\.dev\/e\/machine_decision_refused/);
});
