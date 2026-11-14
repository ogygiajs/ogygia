// The ledger autopilot (src/autopilot.ts): it probes each baseline site's recovery path, runs a
// package's tests once to learn which tests reach it, then breaks each reached recovery and reruns
// only those tests. A test that fails twice proves the site `covered`; one that stays green is a
// test gap; a site no test reaches is left for a buggify point. The source is always put back.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseSync } from 'rolldown/utils';
import { afterAll, describe, expect, it } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import {
	apply_edits,
	autopilot,
	mutants_of,
	probed,
	merge_patch,
	test_name_in,
	type Proof
} from '../src/autopilot.ts';
import { site_nodes, type FailureLedger } from '../src/failures.ts';

const FILE = 'packages/fx/src/a.ts';
const node_of = (source: string, id: string) => {
	const s = site_nodes(FILE, source).find((x) => x.id === id);
	if (!s) throw new Error(`no site ${id}`);
	return s;
};
const parses = (source: string): boolean => parseSync('a.ts', source).errors.length === 0;

describe('probes', () => {
	it('mark each kind of recovery path, and the source still parses', () => {
		const source = dedent`
			export async function f(res: any, p: Promise<unknown>, x: unknown) {
				try { g(); } catch { h(); }
				if (!res.ok) return 1;
				if (x === STALE) return 2;
				if (x !== STALE) k();
				if (!res.body) return 3;
				p.catch(() => 0);
				p.then(ok, bad);
				if (x) throw new Error("x");
				setTimeout(() => res.give_up(), 5);
				p.addEventListener('error', () => res.said());
				p.onerror = () => res.said();
				if (res.aborted) return 4;
				if (x.name === 'AbortError') return 5;
				return { ok: false, onerror: () => 0 };
			}
		`;
		const ids = new Set(site_nodes(FILE, source).map((s) => s.id));
		const out = probed(FILE, source, ids);
		expect(parses(out)).toBe(true);
		for (const id of ids) expect(out).toContain(JSON.stringify(id));
	});

	it('nest when one site holds another', () => {
		const source = dedent`
			export function f(p: Promise<unknown>) {
				return p.catch((e) => { try { g(e); } catch { throw e; } });
			}
		`;
		const ids = new Set(site_nodes(FILE, source).map((s) => s.id));
		expect(ids.size).toBe(3);
		const out = probed(FILE, source, ids);
		expect(parses(out)).toBe(true);
	});

	it('leave a path that was not taken unmarked: a probe records only the recovery', async () => {
		const source = dedent`
			export function f(res, x) {
				const a = !res.ok ? "bad" : "good";
				const b = x !== STALE ? "fresh" : "stale";
				return [a, b];
			}
		`;
		const ids = new Set(site_nodes(FILE, source).map((s) => s.id));
		const out = probed(FILE, source, ids);
		const hits: string[] = [];
		const g = globalThis as {
			__ogygia_autopilot?: (id: string) => void;
			STALE?: unknown;
		};
		g.__ogygia_autopilot = (id) => void hits.push(id);
		g.STALE = Symbol('stale');
		try {
			const js = stripTypeScriptTypes(out.replace('export function', 'function'));
			// oxlint-disable-next-line typescript/no-implied-eval -- runs the code the autopilot transform wrote
			const f = new Function(`${js}; return f;`)() as (r: unknown, x: unknown) => string[];
			expect(f({ ok: true }, 1)).toEqual(['good', 'fresh']);
			expect(hits).toEqual([]);
			expect(f({ ok: false }, g.STALE)).toEqual(['bad', 'stale']);
			expect(hits.sort()).toEqual([...ids].sort());
		} finally {
			delete g.__ogygia_autopilot;
			delete g.STALE;
		}
	});
});

describe('mutants', () => {
	const cases: [string, string, string, RegExp][] = [
		['catch', 'try { g(); } catch { h(); }', 'f > catch:0', /catch \{\}/],
		[
			'catch rethrow',
			'try { g(); } catch (e) { h(e); }',
			'f > catch:0',
			/catch \(e\) \{ throw e; \}/
		],
		['.catch', 'p.catch(() => 0);', 'f > .catch:0', /p\.catch\(\(e: unknown\) => \{ throw e; \}\)/],
		[
			'reject',
			'p.then(ok, bad);',
			'f > reject:0',
			/p\.then\(ok, \(e: unknown\) => \{ throw e; \}\)/
		],
		['not-ok', 'if (!res.ok) return 1;', 'f > not-ok:0', /if \(false\) return 1;/],
		['stale', 'if (x === STALE) return 2;', 'f > stale:0', /if \(false\) return 2;/],
		['stale, negated', 'if (x !== STALE) k();', 'f > stale:0', /if \(true\) k\(\);/],
		['body', 'if (!res.body) return 3;', 'f > body:0', /if \(false\) return 3;/],
		['throw', 'if (x) throw new Error("x");', 'f > throw:0', /if \(x\) \{\}/],
		['result', 'return { ok: false };', 'f > result:0', /return \{ ok: true \};/],
		[
			'timer',
			'setTimeout(() => res.give_up(), 5);',
			'f > timer:0',
			/setTimeout\(\(\) => \{\}, 5\);/
		],
		[
			"scope's timer",
			'p.timeout(5, () => res.give_up());',
			'f > timer:0',
			/p\.timeout\(5, \(\) => \{\}\);/
		],
		[
			'error listener',
			"p.addEventListener('error', () => res.said());",
			'f > error-event:0',
			/p\.addEventListener\('error', \(\) => \{\}\);/
		],
		[
			'error handler',
			'p.onerror = () => res.said();',
			'f > error-event:0',
			/p\.onerror = \(\) => \{\};/
		],
		[
			'error handler property',
			'return { onerror: () => res.said() };',
			'f > error-event:0',
			/return \{ onerror: \(\) => \{\} \};/
		],
		['aborted check', 'if (res.aborted) return 4;', 'f > abort:0', /if \(false\) return 4;/],
		[
			'AbortError check',
			"if (x.name === 'AbortError') return 5;",
			'f > abort:0',
			/if \(false\) return 5;/
		]
	];
	for (const [what, line, site, want] of cases)
		it(`break the recovery of a ${what} site`, () => {
			const source = dedent`
				export function f(res: any, p: any, x: any) {
					${line}
				}
			`;
			const muts = mutants_of(node_of(source, `${FILE} > ${site}`));
			const out = muts.map((m) => apply_edits(source, m.edits));
			expect(out.some((o) => want.test(o))).toBe(true);
			for (const o of out) expect(parses(o)).toBe(true);
		});

	it('give a catch with no binding one to rethrow, and an empty catch only the rethrow', () => {
		const source = dedent`
			export function f() {
				try { g(); } catch {}
			}
		`;
		const muts = mutants_of(node_of(source, `${FILE} > f > catch:0`));
		expect(muts.map((m) => m.operator)).toEqual(['rethrow']);
		const out = apply_edits(source, muts[0].edits);
		expect(out).toContain('catch (autopilot_error) { throw autopilot_error; }');
		expect(parses(out)).toBe(true);
	});
});

describe('a test named in its file', () => {
	it('is its own name, or the each template that made it', () => {
		const text = dedent`
			it('plain', () => {});
			it.each([['x', 1]])('%j gives %d', () => {});
			it.each([{ a: 'q' }])("$a stays 100%%", () => {});
		`;
		expect(test_name_in(text, 'plain')).toBe('plain');
		expect(test_name_in(text, '"x" gives 1')).toBe('%j gives %d');
		expect(test_name_in(text, 'q stays 100%')).toBe('$a stays 100%%');
		expect(test_name_in(text, 'nothing here')).toBe(null);
	});
});

describe('the ledger patch', () => {
	it('moves proved sites from the baseline to covered and leaves the rest', () => {
		const ledger = {
			scope: { packages: ['fx'], exclude: [] },
			fired: [],
			covered: [],
			impossible: [],
			baseline: ['a', 'b', 'c']
		} as FailureLedger;
		const proofs: Proof[] = [{ site: 'b', reason: 'r', test: 't.test.ts', name: 'n' }];
		const out = merge_patch(ledger, proofs);
		expect(out.baseline).toEqual(['a', 'c']);
		expect(out.covered).toEqual([{ site: 'b', reason: 'r', test: 't.test.ts', name: 'n' }]);
	});

	it('refuses a proof for a site not in the baseline', () => {
		const ledger = {
			scope: { packages: ['fx'], exclude: [] },
			fired: [],
			covered: [],
			impossible: [],
			baseline: ['a']
		} as FailureLedger;
		expect(() => merge_patch(ledger, [{ site: 'z', reason: 'r', test: 't', name: 'n' }])).toThrow(
			/not in the baseline: z/
		);
	});
});

const SOURCE = `export function parse_or_null(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export const log: string[] = [];

export function status(res: { ok: boolean }): string {
	if (!res.ok) log.push('bad');
	return 'done';
}

export function never(): number {
	try {
		return 1;
	} catch {
		return 0;
	}
}

export function guard(n: number): number {
	if (n < 0) throw new Error('negative');
	return n;
}

export function digits(text: string): string {
	if (!/^\\d+$/.test(text)) throw new Error('not digits');
	return text;
}

export function late(): Promise<string> {
	return new Promise((answer) => setTimeout(() => answer('late'), 1));
}
`;

const SPEC = `import { parse_or_null, status, guard, digits, late } from '../src/a.ts';

test.each(['x', 'y'])('%j is refused as digits', (text) => {
	expect(() => digits(text)).toThrow('not digits');
});

test('a bad text parses to null', () => {
	expect(parse_or_null('{')).toBe(null);
});

test('a failed answer still says done', () => {
	expect(status({ ok: false })).toBe('done');
});

test('a negative number is refused', () => {
	expect(() => guard(-1)).toThrow('negative');
});

test('a deadline gives up late', async () => {
	expect(await late()).toBe('late');
}, 1000);
`;

describe('a run over a package', () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const d of dirs) rmSync(d, { recursive: true, force: true });
	});

	it('proves what a test checks, names what it only reaches, and puts every byte back', async () => {
		const root = mkdtempSync(join(tmpdir(), 'autopilot-'));
		dirs.push(root);
		mkdirSync(join(root, 'packages/fx/src'), { recursive: true });
		mkdirSync(join(root, 'packages/fx/test'), { recursive: true });
		writeFileSync(join(root, 'packages/fx/src/a.ts'), SOURCE);
		writeFileSync(join(root, 'packages/fx/test/a.spec.ts'), SPEC);
		writeFileSync(
			join(root, 'packages/fx/vitest.config.ts'),
			"export default { test: { include: ['test/**/*.spec.ts'], environment: 'node', globals: true } };\n"
		);
		const baseline = site_nodes(FILE, SOURCE).map((s) => s.id);
		const out = join(root, 'out');
		const report = await autopilot({
			root,
			pkg: 'fx',
			baseline,
			out,
			vitest: resolve(import.meta.dirname, '../node_modules/.bin/vitest'),
			projects: [null],
			timeout_ms: 60_000,
			quiet: true
		});
		expect(readFileSync(join(root, 'packages/fx/src/a.ts'), 'utf8')).toBe(SOURCE);
		expect(report.proved.map((p) => [p.site, p.name])).toEqual([
			[`${FILE} > parse_or_null > catch:0`, 'a bad text parses to null'],
			[`${FILE} > guard > throw:0`, 'a negative number is refused'],
			[`${FILE} > digits > throw:0`, '%j is refused as digits'],
			[`${FILE} > late > timer:0`, 'a deadline gives up late']
		]);
		expect(report.proved[0].test).toBe('packages/fx/test/a.spec.ts');
		expect(report.survived.map((s) => s.site)).toEqual([`${FILE} > status > not-ok:0`]);
		expect(report.unreached).toEqual([`${FILE} > never > catch:0`]);
		expect(report.unhandled).toEqual([`${FILE} > parse_or_null > parse:0`]);
	}, 180_000);

	const make_package = (source: string, spec: string): string => {
		const root = mkdtempSync(join(tmpdir(), 'autopilot-'));
		dirs.push(root);
		mkdirSync(join(root, 'packages/fx/src'), { recursive: true });
		mkdirSync(join(root, 'packages/fx/test'), { recursive: true });
		writeFileSync(join(root, 'packages/fx/src/a.ts'), source);
		writeFileSync(join(root, 'packages/fx/test/a.spec.ts'), spec);
		writeFileSync(
			join(root, 'packages/fx/vitest.config.ts'),
			"export default { test: { include: ['test/**/*.spec.ts'], environment: 'node', globals: true } };\n"
		);
		return root;
	};
	const VITEST = resolve(import.meta.dirname, '../node_modules/.bin/vitest');

	it('maps again when the sites it was asked about change, never reading the others as unreached', async () => {
		const root = make_package(SOURCE, SPEC);
		const baseline = site_nodes(FILE, SOURCE).map((s) => s.id);
		const o = { root, pkg: 'fx', baseline, out: join(root, 'out'), vitest: VITEST };
		const run = { projects: [null], timeout_ms: 60_000, quiet: true };
		const first = await autopilot({ ...o, ...run, only: 'guard' });
		expect(first.proved.map((p) => p.site)).toEqual([`${FILE} > guard > throw:0`]);
		const all = await autopilot({ ...o, ...run });
		expect(all.unreached).toEqual([`${FILE} > never > catch:0`]);
		expect(all.proved.map((p) => p.site)).toContain(`${FILE} > parse_or_null > catch:0`);
	}, 180_000);

	it('names the test that hung when a run is stopped, never one that passed before it', async () => {
		const source = dedent`
			export function retry(n: number, tries: number): number {
				for (let i = 0; i < tries; i++) {
					try {
						if (n < 0) throw new Error('negative');
						return n;
					} catch {
						return -1;
					}
				}
				return 0;
			}
		`;
		const spec = dedent`
			import { retry } from '../src/a.ts';

			test('a few tries end', () => {
				retry(-1, 3);
			});

			test('a negative number gives up at once', () => {
				expect(retry(-1, Infinity)).toBe(-1);
			});
		`;
		const root = make_package(source, spec);
		const report = await autopilot({
			root,
			pkg: 'fx',
			baseline: [`${FILE} > retry > catch:0`],
			out: join(root, 'out'),
			vitest: VITEST,
			projects: [null],
			timeout_ms: 8_000,
			quiet: true
		});
		expect(readFileSync(join(root, 'packages/fx/src/a.ts'), 'utf8')).toBe(source);
		expect(
			report.proved.map((p) => [
				p.name,
				p.reason.endsWith('hangs the test past the run time limit')
			])
		).toEqual([['a negative number gives up at once', true]]);
	}, 180_000);
});
