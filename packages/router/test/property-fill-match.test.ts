// A filled pattern, read by the WHATWG URL parser (what fetch and the browser do with it), matches
// its own pattern with the same params, or fill refuses it: a param never sends a request to a
// route the caller did not name (#1099).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { compile, fill, match_one } from '../src/match.ts';

const SEED = 314;
const PATTERNS = [
	'/posts/[id]',
	'/users/[id]/delete',
	'/f/[...rest]',
	'/[[lang]]/docs',
	'/d/[id].json',
	'/a/[x]~[y]'
];
/** Pieces that are special to a URL: dots, slashes, escapes, the query and the hash. */
const UNIT = fc.constantFrom(
	'.',
	'/',
	'%',
	'2e',
	'2E',
	'a',
	' ',
	'?',
	'#',
	'\\',
	'é',
	'\u0000',
	'+'
);

/** `p` filled with `values`, then read back through the URL parser; null when fill refused it. */
function round_trip(p: string, values: Record<string, string>) {
	let filled: string;
	try {
		filled = fill(p, values);
	} catch {
		return null;
	}
	const m = match_one(compile(p), new URL(filled, 'https://app.test').pathname);
	return m && m.params;
}

describe('fill, read back through the URL parser', () => {
	it('gives back the params as filled, or refuses them', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...PATTERNS),
				fc.string({ unit: UNIT, minLength: 1, maxLength: 5 }),
				fc.string({ unit: UNIT, minLength: 1, maxLength: 5 }),
				(p, a, b) => {
					const names = compile(p).params.map((s) => s.name);
					const values: Record<string, string> = { [names[0]]: a };
					if (names[1]) values[names[1]] = b;
					const back = round_trip(p, values);
					if (back === null) {
						// refused: only a value the URL parser would drop as a dot segment (a rest value
						// keeps its `/`, so each of its pieces is a segment of its own, #538)
						const rest = new Set(
							compile(p)
								.params.filter((s) => s.rest)
								.map((s) => s.name)
						);
						const dot = (v: string) => v === '.' || v === '..';
						expect(
							Object.entries(values).some(([k, v]) =>
								rest.has(k) ? v.split('/').some(dot) : dot(v)
							)
						).toBe(true);
						return;
					}
					expect(back).toEqual(values);
				}
			),
			{ seed: SEED, numRuns: 3000 }
		);
	});

	it('refuses a param that would fill a whole segment with a dot segment', () => {
		for (const v of ['.', '..'])
			for (const p of ['/users/[id]/delete', '/posts/[id]', '/f/[...rest]', '/[[lang]]/docs'])
				expect(() => fill(p, { id: v, rest: v, lang: v })).toThrow(/dot segment/);
		// a segment made of several tokens, or a token and a literal dot, is a dot segment too
		expect(() => fill('/x/[a].[b]', { b: '.' })).toThrow(/dot segment/);
		expect(() => fill('/x/[a][b]', { a: '.', b: '.' })).toThrow(/dot segment/);
		expect(() => fill('/x/[id].', { id: '' })).toThrow(/dot segment/);
		// a rest value keeps its `/`, so a dot piece of it is a dot segment
		expect(() => fill('/f/[...rest]', { rest: 'a/../b' })).toThrow(/dot segment/);
		expect(fill('/f/[...rest]', { rest: 'a/.b/c' })).toBe('/f/a/.b/c');
		// …and an empty piece is an empty segment: refused, so a value never builds `//host`
		// (a URL of another origin) or a path that routes elsewhere
		expect(() => fill('/[...p]', { p: '/evil.example.com' })).toThrow(/empty segment/);
		expect(() => fill('/f/[...rest]', { rest: 'a//b' })).toThrow(/empty segment/);
		expect(() => fill('/f/[...rest]', { rest: 'a/' })).toThrow(/empty segment/);
		expect(fill('/[...p]', { p: '' })).toBe('/');
		// a dot inside a segment is kept: the URL parser drops only a whole `.` or `..` segment
		expect(fill('/d/[id].json', { id: '.' })).toBe('/d/..json');
		expect(fill('/posts/[id]', { id: '...' })).toBe('/posts/...');
	});
});
