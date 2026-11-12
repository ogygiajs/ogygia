/**
 * When two patterns match one path, the router picks the route Kit would pick for the same files
 * (#1139): segments compare from the left, an `[[optional]]` that is not last counts for nothing,
 * a last `[[optional]]` or `[...rest]` ranks lowest, and a tie goes by route id, so the pick never
 * depends on the order the table was written in.
 */
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { compile, compile_all, match_one, match_path } from '../src/match.ts';

/** the route `path` resolves to, for the table written in both orders */
const picks = (table: [string, string], path: string) => [
	match_path(compile_all(table), path)?.pattern,
	match_path(compile_all([table[1], table[0]]), path)?.pattern
];

describe('overlapping patterns resolve as Kit resolves them (#1139)', () => {
	const cases: [[string, string], string, string][] = [
		[['/b', '/b/[[o]]'], '/b', '/b'],
		[['/a', '/[[lang]]/a'], '/a', '/a'],
		[['/[p]', '/[[o]]/[p]'], '/c', '/[p]'],
		[['/a/[...r]', '/[p]/[q]'], '/a/b', '/a/[...r]'],
		[['/[p]/[...r]', '/[[o]]/[[oz]]'], '/b', '/[p]/[...r]'],
		[['/[p]', '/[q]'], '/b', '/[q]'],
		[['/b/[...r]', '/[[o]]/b/[...r]'], '/b', '/b/[...r]'],
		[['/[p].json', '/[p]/[[o]]'], '/1.json', '/[p].json']
	];
	for (const [table, path, kit] of cases) {
		it(`${table.join(' and ')} at ${path} is ${kit}`, () => {
			expect(picks(table, path)).toEqual([kit, kit]);
		});
	}
});

describe('the order a table is written in never changes a pick', () => {
	const SEG = ['a', 'b', '[p]', '[q]', '[[o]]', 'x-[p]', '[p].json'];
	const pattern = fc
		.tuple(fc.array(fc.constantFrom(...SEG), { minLength: 1, maxLength: 3 }), fc.boolean())
		.map(([segs, rest]) => {
			let n = 0;
			// each param its own name
			const named = segs.map((s) =>
				s.replace(/\[(\[?)(\w)/, (_m, b: string, c: string) => `[${b}${c}${n++}`)
			);
			return `/${[...named, ...(rest ? [`[...v${n}]`] : [])].join('/')}`;
		});
	const path = fc
		.array(fc.constantFrom('a', 'b', 'c', 'x-1', '1.json'), { maxLength: 4 })
		.map((w) => `/${w.join('/')}`);

	it('two patterns that both match a path: the same winner either way round', () => {
		fc.assert(
			fc.property(pattern, pattern, path, (a, b, p) => {
				fc.pre(a !== b);
				if (!match_one(compile(a), p) || !match_one(compile(b), p)) return;
				const [one, two] = picks([a, b], p);
				expect(one).toBe(two);
			}),
			{ numRuns: 2000 }
		);
	});
});
