// Every failure site accounted for (src/failures.ts): fired by a buggify point or a sim fault in the
// sweep, covered by a named real test, or impossible by a named rule or type. The baseline (sites
// nobody has bucketed yet) may only shrink.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import {
	account_failures,
	base_after_renames,
	faults_in,
	points_in,
	shapes_in,
	sites_of,
	type FailureLedger
} from '../src/failures.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const ids = (source: string): string[] => sites_of('packages/x/src/a.ts', source).map((s) => s.id);

describe('failure sites', () => {
	it('finds each kind, named by the function around it', () => {
		const got = ids(`
			async function load(url) {
				try {
					const res = await fetch(url);
					if (!res.ok) return null;
					return JSON.parse(await res.text());
				} catch {
					return null;
				}
			}
			const go = async () => {
				const m = await import('./m.ts');
				p.then(ok, bad);
				p.catch(noop);
				if (x === STALE) return;
				localStorage.getItem('k');
				new IntersectionObserver(cb);
				AbortSignal.timeout(5);
				const retry = policy({ tries: 3 });
			};
		`);
		expect(got).toEqual([
			'packages/x/src/a.ts > load > fetch:0',
			'packages/x/src/a.ts > load > not-ok:0',
			'packages/x/src/a.ts > load > parse:0',
			'packages/x/src/a.ts > load > catch:0',
			'packages/x/src/a.ts > go > import:0',
			'packages/x/src/a.ts > go > reject:0',
			'packages/x/src/a.ts > go > .catch:0',
			'packages/x/src/a.ts > go > stale:0',
			'packages/x/src/a.ts > go > storage:0',
			'packages/x/src/a.ts > go > observer:0',
			'packages/x/src/a.ts > go > timer:0',
			'packages/x/src/a.ts > go > policy:0'
		]);
	});

	it('gives a class method its class, an anonymous callback its named function, and counts per kind', () => {
		const got = ids(`
			class Box {
				send() {
					try { a(); } catch {}
					list.forEach(() => { try { b(); } catch {} });
				}
			}
			try { c(); } catch {}
		`);
		expect(got).toEqual([
			'packages/x/src/a.ts > Box > send > catch:0',
			'packages/x/src/a.ts > Box > send > catch:1',
			'packages/x/src/a.ts > (module) > catch:0'
		]);
	});

	it("keeps a site's id when lines above it move", () => {
		const one = ids('function f() { try { a(); } catch {} }');
		const two = ids(dedent`
			const y = 1;

			function f() {

				try { a(); } catch {} }
		`);
		expect(two).toEqual(one);
	});

	it('finds aborts, error events, streams, messages, throws, refused moves, failed results, crypto and null bodies', () => {
		const got = ids(dedent`
			function h(res, el, ctl, m) {
				const ac = new AbortController();
				if (ac.signal.aborted) return;
				if (e.name === 'AbortError') return;
				el.addEventListener('error', on_error);
				el.onerror = on_error;
				res.body.getReader();
				ctl.enqueue(chunk);
				controller.error(e);
				navigator.sendBeacon(url, data);
				if (!m.move('busy', 'done')) return { ok: false };
				crypto.subtle.verify(alg, key, sig, data);
				if (res.body === null) throw new Error('no body');
				setTimeout(go, 5);
			}
		`);
		expect(got.map((id) => id.split(' > ').at(-1))).toEqual([
			'abort:0',
			'abort:1',
			'abort:2',
			'error-event:0',
			'error-event:1',
			'stream:0',
			'stream:1',
			'stream:2',
			'message:0',
			'refused:0',
			'result:0',
			'crypto:0',
			'body:0',
			'throw:0',
			'timer:0'
		]);
	});

	it('a move is a machine move only from a named state: a text edit or a dependency mark is no refusal', () => {
		expect(
			ids("function f(s, v, m, part) { s.move(0, 4, 9); v.move('regions'); v.move(part); }")
		).toEqual([]);
	});

	it('does not count a successful call as a failure, nor a function of its own named verify', () => {
		expect(ids('function f(res) { if (res.ok) go(); x.then(ok); verify(host, k); }')).toEqual([]);
		expect(ids('function f() { hmac.verify(sig); }')).toEqual([
			'packages/x/src/a.ts > f > crypto:0'
		]);
	});

	it("names each way the rewrite refuses a render's answer, so a buggify point can fire it: a wrong count, html that does not close, lost marks, an element split across chunks", () => {
		const file = 'packages/rewrite/src/pass.ts';
		const found = new Set(
			sites_of(file, readFileSync(join(ROOT, file), 'utf8')).map((s) => s.id.slice(file.length + 3))
		);
		for (const id of [
			'counted > result:0',
			'judge > result:2',
			'judge > result:3',
			'rewrite_chunk > result:0'
		])
			expect(found, id).toContain(id);
	});

	it('reads the buggify points a source asks, and the sim fault classes', () => {
		expect(points_in("if (RULES && buggify.fires('hole.fetch-lost')) throw e;")).toEqual([
			'hole.fetch-lost'
		]);
		const network = ['export type FaultClass =', "\t| 'drop'", "\t| 'cut';", "const x = 'no';"];
		expect(faults_in(network.join('\n'))).toEqual(['drop', 'cut']);
	});
});

const SITES = new Set(['f > catch:0', 'f > fetch:0', 'g > stale:0', 'h > parse:0', 'k > catch:0']);

const ledger = (over: Partial<FailureLedger> = {}): FailureLedger => ({
	scope: { packages: ['x'], exclude: [] },
	fired: [{ site: 'f > catch:0', point: 'p.lost', how: 'p throws in the try', killed_by: 'm1' }],
	covered: [
		{ site: 'f > fetch:0', reason: 'a real browser', test: 't/a.test.ts', name: 'retries a fetch' }
	],
	impossible: [{ site: 'g > stale:0', why: 'a rule', by: 'src/rules.ts', name: 'never_stale' }],
	baseline: ['h > parse:0', 'k > catch:0'],
	...over
});

const files: Record<string, string> = {
	't/a.test.ts': "it('retries a fetch', () => {});",
	'src/rules.ts': 'export const never_stale = rule();'
};
const o = {
	read: (p: string): string | null => files[p] ?? null,
	points: new Set(['p.lost']),
	faults: new Set(['drop']),
	shapes: new Set(['gen messy']),
	mutants: new Set(['m1'])
};

describe('failure sites accounted', () => {
	it('passes a ledger with every site in exactly one bucket or the baseline', () => {
		const a = account_failures(SITES, ledger(), o);
		expect(a.failures).toEqual([]);
		expect([a.accounted, a.total, a.baseline, a.proved]).toEqual([3, 5, 2, 1]);
	});

	it('fails a new site in no bucket', () => {
		const a = account_failures(new Set([...SITES, 'n > catch:0']), ledger(), o);
		expect(a.failures).toEqual(['in no bucket: n > catch:0']);
	});

	it('fails a baseline that grew against the base', () => {
		const a = account_failures(SITES, ledger(), { ...o, base: new Set(['h > parse:0']) });
		expect(a.failures).toEqual(['the baseline grew (put it in a bucket instead): k > catch:0']);
	});

	it('reads the base baseline under a moved file’s new name, so a move is not growth', () => {
		const base = base_after_renames(
			['old/h > parse:0', 'old/k > catch:0', 'f > catch:0'],
			new Map([
				['old/h', 'h'],
				['old/k', 'k']
			])
		);
		expect([...base]).toEqual(['h > parse:0', 'k > catch:0', 'f > catch:0']);
		expect(account_failures(SITES, ledger(), { ...o, base }).failures).toEqual([]);
	});

	it('fails a baseline id no site has (it may only shrink, so it is taken out)', () => {
		const a = account_failures(new Set([...SITES].filter((s) => s !== 'k > catch:0')), ledger(), o);
		expect(a.failures).toEqual(['no site has it (take it out of the baseline): k > catch:0']);
	});

	it('fails a site in two buckets', () => {
		const a = account_failures(
			SITES,
			ledger({ baseline: ['h > parse:0', 'k > catch:0', 'f > catch:0'] }),
			o
		);
		expect(a.failures).toEqual(['in two buckets: f > catch:0 (fired, baseline)']);
	});

	it('fails a bucket whose evidence is gone: a point, a fault, a mutant, a test or a rule', () => {
		const a = account_failures(
			SITES,
			ledger({
				fired: [
					{ site: 'f > catch:0', point: 'p.gone', how: '' },
					{ site: 'k > catch:0', fault: 'melt', how: '' },
					{ site: 'h > parse:0', point: 'p.lost', how: '', killed_by: 'm.gone' }
				],
				baseline: []
			}),
			{ ...o, read: () => null }
		);
		expect(a.failures).toEqual([
			"f > catch:0: no buggify point 'p.gone' in the packages' source",
			"k > catch:0: no sim fault 'melt'",
			"h > parse:0: no live mutant 'm.gone' in mutants.json",
			'f > fetch:0: its test file is not there: t/a.test.ts',
			"g > stale:0: its rule's file is not there: src/rules.ts"
		]);
	});

	it('fails a fired site in a package no simulator runs (its sites are covered by tests)', () => {
		const pkg = 'packages/cli/src/a.ts > f > catch:0';
		const a = account_failures(
			new Set([...SITES, pkg]),
			ledger({
				scope: { packages: ['x', 'cli'], exclude: [], build_time: ['cli'] },
				fired: [{ site: pkg, point: 'p.lost', how: '' }],
				baseline: ['h > parse:0', 'k > catch:0', 'f > catch:0']
			}),
			o
		);
		expect(a.failures).toEqual([
			`${pkg}: a build-time package's site is covered by a test, never fired`
		]);
	});

	it('fails a point the source asks that no ledger entry names (no orphan points), and a step point the source lost', () => {
		const a = account_failures(
			SITES,
			ledger({ step_points: [{ point: 'p.keep', steps: ['m: kept -> gone'], how: '' }] }),
			{ ...o, points: new Set(['p.lost', 'p.orphan']) }
		);
		expect(a.failures).toEqual([
			'an orphan point (no ledger entry names it): p.orphan',
			"no buggify point 'p.keep' in the packages' source (step_points)"
		]);
	});

	it("fails a step point whose kill names no live mutant (batch.part-lost's release, proved aimed)", () => {
		const a = account_failures(
			SITES,
			ledger({
				step_points: [{ point: 'p.lost', steps: ['m: kept -> gone'], how: '', killed_by: 'm.gone' }]
			}),
			o
		);
		expect(a.failures).toEqual(["p.lost: no live mutant 'm.gone' in mutants.json (step_points)"]);
	});

	it('passes a site an app shape fires (a gen stream), and fails one whose shape gen.ts no longer draws, or that names two ways', () => {
		const shaped = (shape: string, point?: string) =>
			account_failures(
				SITES,
				ledger({
					fired: [{ site: 'f > catch:0', shape, point, how: '' }]
				}),
				{ ...o, points: new Set(point ? [point] : []) }
			).failures;
		expect(shaped('gen messy')).toEqual([]);
		expect(shaped('gen gone')).toEqual(["f > catch:0: no app shape 'gen gone' in gen.ts"]);
		expect(shaped('gen messy', 'p.lost')).toEqual([
			'f > catch:0: a fired site names one point, fault or shape'
		]);
		expect(shapes_in("const m = rng(seed).fork('gen messy');")).toEqual(['gen messy']);
	});

	it("passes a site a point of the random app's own code fires, with no orphan check for it", () => {
		const a = account_failures(
			SITES,
			ledger({ fired: [{ site: 'f > catch:0', point: 'gen.pass-throws', how: '' }] }),
			{ ...o, points: new Set(), app_points: new Set(['gen.pass-throws', 'gen.unused']) }
		);
		expect(a.failures).toEqual([]);
	});

	it('fails a fired site whose point did not fire in the sweep', () => {
		const a = account_failures(SITES, ledger(), { ...o, fired: new Set<string>() });
		expect(a.failures).toEqual(["f > catch:0: its point 'p.lost' did not fire in the sweep"]);
	});

	it('passes an equivalent site with its written reason, and counts it accounted', () => {
		const a = account_failures(
			SITES,
			ledger({
				equivalent: [{ site: 'k > catch:0', why: 'the code after the check does the same' }],
				baseline: ['h > parse:0']
			}),
			o
		);
		expect(a.failures).toEqual([]);
		expect([a.accounted, a.baseline]).toEqual([4, 1]);
	});

	it('refuses an equivalent site without a written reason', () => {
		const a = account_failures(
			SITES,
			ledger({
				equivalent: [
					{ site: 'k > catch:0', why: '  ' },
					{ site: 'h > parse:0' } as unknown as FailureLedger['equivalent'][number]
				],
				baseline: []
			}),
			o
		);
		expect(a.failures).toEqual([
			'k > catch:0: an equivalent site says why breaking it changes nothing',
			'h > parse:0: an equivalent site says why breaking it changes nothing'
		]);
	});
});
