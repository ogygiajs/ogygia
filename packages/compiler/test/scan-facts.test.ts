// THE SCAN'S FACTS as queries (src/compiler/scan-facts.ts): the app-wide answers are folds over
// every scanned file's facts, computed again only when a fact they read changed. After any run of
// fact changes (a file scanned, edited, deleted, scanned again), every fold equals the one a fresh
// set of facts gives, fed the final facts in the same scan order.
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { scan_facts, type FileFacts, type ScanFacts } from '../src/compiler/scan-facts.ts';

const FILES = ['/a/x.ts', '/a/y.svelte', '/a/z.remote.ts', '/a/w.ts'];

const facts_arb: fc.Arbitrary<FileFacts | null> = fc.option(
	fc.record({
		crosses_wire: fc.boolean(),
		transportable: fc.boolean(),
		specs: fc.array(fc.constantFrom('$lib/a', '@ogygia/router', './b'), { maxLength: 2 }),
		router: fc.boolean(),
		flag_sites: fc.array(
			fc.record({
				name: fc.constantFrom('nav', 'csr'),
				kind: fc.constant('flag' as const),
				file: fc.constant('f.ts'),
				line: fc.nat(9)
			}),
			{ maxLength: 2 }
		)
	}),
	{ nil: null }
);

const folds = (s: ScanFacts) => ({
	transportable: [...s.db.get(s.transportable_modules, 'all')],
	wire: [...s.db.get(s.wire_crossers, 'all')],
	router: [...s.db.get(s.router_modules, 'all')],
	specs: [...s.db.get(s.module_specs, 'all')],
	flags: s.db.get(s.flag_sites, 'all')
});

describe('scan facts', () => {
	test('after any run of fact changes, every fold equals a fresh one fed the final facts', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(fc.constantFrom(...FILES), facts_arb), { minLength: 1, maxLength: 25 }),
				(ops) => {
					const dev = scan_facts();
					const first_seen: string[] = [];
					const last = new Map<string, FileFacts | null>();
					for (const [file, facts] of ops) {
						dev.set(file, facts);
						if (facts !== null && !first_seen.includes(file)) first_seen.push(file);
						if (first_seen.includes(file)) last.set(file, facts);
						const cold = scan_facts();
						for (const f of first_seen) cold.set(f, last.get(f) ?? null);
						expect(folds(dev)).toEqual(folds(cold));
					}
				}
			),
			{ numRuns: Number(process.env.QUERIES_RUNS) || 300 }
		);
	}, 600_000);

	test('setting a file the facts it has moves no fold', () => {
		const s = scan_facts();
		const facts: FileFacts = {
			crosses_wire: true,
			transportable: false,
			specs: ['$lib/a'],
			router: false,
			flag_sites: []
		};
		s.set('/a/x.ts', facts);
		folds(s);
		const since = s.db.revision;
		s.set('/a/x.ts', { ...facts, specs: ['$lib/a'] });
		expect(s.db.revision).toBe(since);
		s.set('/a/x.ts', { ...facts, specs: ['$lib/b'] });
		expect(s.db.changed_since(s.module_specs, 'all', since)).toBe(true);
		expect(s.db.changed_since(s.wire_crossers, 'all', since)).toBe(false);
	});

	test('a deleted file leaves every fold, and has() says so', () => {
		const s = scan_facts();
		s.set('/a/x.ts', {
			crosses_wire: true,
			transportable: true,
			specs: [],
			router: true,
			flag_sites: []
		});
		expect(s.has('/a/x.ts')).toBe(true);
		s.set('/a/x.ts', null);
		expect(s.has('/a/x.ts')).toBe(false);
		expect(folds(s)).toEqual({ transportable: [], wire: [], router: [], specs: [], flags: [] });
	});
});
