// The region grids' own tools: the case-list folding, the report, and the checks every case holds.
import { expect, test } from 'vitest';
import { fold, GridReport } from './_region-grid-report.ts';
import { html_findings, unbalanced_markers } from './_region-grid-checks.ts';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AT, cases_of, KINDS, product } from './_region-grid.ts';

const expand = (blocks: number[][][]) =>
	blocks
		.flatMap((b) => product(Object.fromEntries(b.map((s, i) => [`a${i}`, s.map(String)]))))
		.map((r) => Object.values(r).map(Number))
		.map((t) => t.join(','))
		.sort();

test('a folded case list names exactly the cases it was given, no more and no fewer', () => {
	const tuples = [
		[0, 0, 0],
		[0, 1, 0],
		[1, 0, 0],
		[1, 1, 0],
		[2, 1, 1]
	];
	const blocks = fold(tuples, 3);
	expect(expand(blocks)).toEqual(tuples.map((t) => t.join(',')).sort());
	expect(blocks).toEqual([
		[[0, 1], [0, 1], [0]],
		[[2], [1], [1]]
	]);
});

test('a report writes each distinct value of each part once, in full, with its cases', () => {
	const report = new GridReport({ x: ['a', 'b'], y: ['1', '2'] });
	report.add({ x: 'a', y: '1' }, { body: '<p data-og-fp="0123456789abcdef">1</p>', said: '[]' });
	report.add({ x: 'b', y: '1' }, { body: '<p data-og-fp="fedcba9876543210">1</p>', said: '[]' });
	report.add({ x: 'a', y: '2' }, { body: '<p>2</p>', said: '["warned"]' });
	report.add({ x: 'b', y: '2' }, { body: '<p>2</p>', said: '[]' });
	expect([report.cases, report.distinct]).toEqual([4, 3]);
	expect(report.render('t')).toMatchInlineSnapshot(`
		"# t
		# 4 cases, 3 distinct outputs; per part: body 2, said 2.
		# axes: x=a|b y=1|2

		################ body · 2 distinct ################

		════ body 1 · 2 cases ════
		<p data-og-fp="<fp1>">1</p>
		──── with <fp1>=0123456789abcdef · 1:
		x=a y=1
		──── with <fp1>=fedcba9876543210 · 1:
		x=b y=1

		════ body 2 · 2 cases ════
		<p>2</p>
		──── no hashes · 2:
		x=* y=2

		################ said · 2 distinct ################

		════ said 1 · 3 cases ════
		[]
		──── no hashes · 3:
		x=a y=1
		x=b y=*

		════ said 2 · 1 case ════
		["warned"]
		──── no hashes · 1:
		x=a y=2
		"
	`);
});

test('the marker check finds an unclosed and an unopened block, per parent', () => {
	expect(unbalanced_markers('<!--[--><p><!--]--></p>')).toEqual([
		'a <!--]--> with no open marker in  > html > body > p',
		'1 marker(s) left open in  > html > body'
	]);
	expect(unbalanced_markers('<!--[-1--><p><!--[!--><!--]--></p><!--]-->')).toEqual([]);
});

test('the HTML check finds what a parser would repair, and passes good HTML', () => {
	expect(html_findings('', '<p><div></div></p>')).not.toEqual([]);
	expect(html_findings('<meta name="a">', '<ogygia-region><p>a</p></ogygia-region>')).toEqual([]);
});

test('every grid file of both sets, every kind, place and async setting, is on disk', () => {
	const sets = { fast: ['page', 'island'], full: [...AT] };
	const hydrate_at = ['page', 'island', 'live-snippet', 'woken-answer'];
	const missing: string[] = [];
	for (const [set, ats] of Object.entries(sets))
		for (const async of ['on', 'off'])
			for (const kind of Object.keys(KINDS))
				for (const [dir, places] of [
					['__snapshots__/region-grid/server', ats],
					['browser/__snapshots__/region-grid/client', ats],
					['browser/__snapshots__/region-grid/hydrate', ats.filter((a) => hydrate_at.includes(a))]
				] as const)
					for (const at of places) {
						const file = `${dir}/${set}/async=${async}/kind=${kind}/at=${at}.txt`;
						if (!existsSync(fileURLToPath(new URL(file, import.meta.url)))) missing.push(file);
					}
	expect(missing).toEqual([]);
});

test('each kind has the full product of its axes, every case named by every axis', () => {
	for (const [kind, k] of Object.entries(KINDS)) {
		const cases = cases_of(kind);
		const n = Object.values(k.axes).reduce((a, vs) => a * vs.length, 1);
		expect([kind, cases.length, new Set(cases.map((c) => c.name)).size]).toEqual([kind, n, n]);
	}
});
