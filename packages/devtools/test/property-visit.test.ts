// Properties of the profiler's beacon ingest (`/beacon` POST: profiler/visit.ts), over generated
// bodies rather than picked ones. The body is JSON the browser wrote, so any JSON at all may come:
// - `parse_visit` never throws; what it keeps is plain data (it survives JSON as itself), with no
//   string or list past its bounds, and Object.prototype untouched;
// - parsing what it kept gives the same visit back;
// - folding any number of posts of one visit (the server keeps one per navigation start) stays
//   inside the same bounds: a poster cannot grow a kept visit without end.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { merge_visits, parse_visit, type Visit } from '../src/profiler/visit.ts';

/** Every field name visit.ts reads, so generated objects hit the parser's paths, not only misses. */
const KEYS = [
	...new Set(
		readFileSync(new URL('../src/profiler/visit.ts', import.meta.url), 'utf8').match(
			/(?<=\.)[a-z][a-z0-9_]*\b/g
		) ?? []
	),
	'__proto__',
	'constructor'
];

/** JSON-shaped values with keys the parser knows, and the numbers and strings near its edges. */
const { value: json } = fc.letrec((tie) => ({
	value: fc.oneof(
		{ depthSize: 'small', withCrossShrink: true },
		fc.constantFrom(null, true, false, 0, -1, 1e9, 1e12, 600_000, 600_001, 1.005, '', '0', '/'),
		fc.double(),
		fc.integer(),
		fc.string({ maxLength: 8 }),
		fc.constant('x'.repeat(5000)),
		fc.stringMatching(/^[0-9a-f]{8,32}$/),
		fc.array(tie('value'), { maxLength: 6 }),
		fc.dictionary(fc.constantFrom(...KEYS), tie('value'), { maxKeys: 10 })
	)
}));

/** A body's `visit` that gets past the parser's first gates, with the rest left to chance. */
const visit_body = fc
	.tuple(
		fc.dictionary(fc.constantFrom(...KEYS), json, { maxKeys: 24 }),
		fc.dictionary(fc.constantFrom(...KEYS), json, { maxKeys: 8 }),
		fc.oneof(fc.double({ min: 0, max: 600_000, noNaN: true }), json)
	)
	.map(([v, nav, res_start]) => ({ ...v, nav: { ...nav, res_start } }))
	// as the endpoint gets it: text read back through JSON.parse (own `__proto__` keys and all)
	.map((v) => JSON.parse(JSON.stringify(v)) as unknown);

/** A list long enough to pass any bound the parser has, of one shape it reads. */
const many = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

/** The bounds a kept visit stays inside, whatever was posted. */
function bounded(v: Visit): void {
	const walk = (x: unknown, path: string): void => {
		if (typeof x === 'string') expect(x.length, path).toBeLessThanOrEqual(500);
		else if (typeof x === 'number') expect(Number.isFinite(x), path).toBe(true);
		else if (Array.isArray(x)) {
			expect(x.length, path).toBeLessThanOrEqual(400);
			x.forEach((y, i) => walk(y, `${path}[${i}]`));
		} else if (x && typeof x === 'object') {
			expect(Object.getPrototypeOf(x), path).toBe(Object.prototype);
			expect(Object.hasOwn(x, '__proto__'), path).toBe(false);
			for (const [k, y] of Object.entries(x)) walk(y, `${path}.${k}`);
		} else expect(['boolean', 'undefined'], path).toContain(typeof x);
	};
	walk(v, 'visit');
	expect(JSON.parse(JSON.stringify(v))).toEqual(v);
}

describe('beacon visit ingest', () => {
	it('any body: never throws; keeps plain, bounded data; leaves Object.prototype alone', () => {
		fc.assert(
			fc.property(fc.oneof(fc.constant('/p'), json), visit_body, (page, raw) => {
				const v = parse_visit(page, raw);
				if (v) bounded(v);
				expect(Object.keys(Object.prototype)).toEqual([]);
			}),
			{ numRuns: 400 }
		);
	});

	it('what it kept parses back to itself', () => {
		let kept = 0;
		fc.assert(
			fc.property(visit_body, (raw) => {
				const v = parse_visit('/p', raw);
				if (!v) return;
				kept++;
				expect(parse_visit('/p', JSON.parse(JSON.stringify(v)))).toEqual(v);
			}),
			{ numRuns: 300 }
		);
		expect(kept, 'the bodies reach past the first gates').toBeGreaterThan(30);
	});

	it('posts of one visit, folded, stay inside the bounds of one post', () => {
		fc.assert(
			fc.property(fc.integer({ min: 2, max: 6 }), (posts) => {
				let kept: Visit | null = null;
				for (let p = 0; p < posts; p++) {
					// each post names new islands, shifts, long tasks, marks and regions of the SAME
					// visit (same navigation start), as many as one post may carry
					const fp = (i: number) => (p * 1000 + i).toString(16).padStart(8, '0');
					const v = parse_visit('/p', {
						at: 1_700_000_000_000,
						nav: { res_start: 1, res_end: 2 },
						islands: many(400, (i) => ({ fp: fp(i), entry: 'e', t0: i, t1: i + 1 })),
						firsts: many(400, (i) => ({ fp: fp(i), type: 'click', t: i })),
						shifts: many(60, (i) => ({ t: p * 100 + i, value: 0.01 })),
						longtasks: many(100, (i) => ({ t: p * 1000 + i, ms: 60 })),
						marks: many(200, (i) => ({ name: `m${p}-${i}`, ms: 1 })),
						regions: many(400, (i) => ({ fp: fp(i) }))
					});
					expect(v, 'the post is a visit').not.toBeNull();
					kept = kept ? merge_visits(kept, v!) : v;
				}
				bounded(kept!);
			}),
			{ numRuns: 5 }
		);
	});
});
