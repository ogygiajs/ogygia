// The shape of the test report CI publishes for each release, as static JSON under /tests:
// /tests/index.json, /tests/<version>/summary.json and /tests/<version>/<package file>.json.
// Shared by the server reader (report.server.ts) and the pages.

export type Kind = 'unit' | 'browser' | 'e2e' | 'types' | 'rules';
export type Engine = 'node' | 'chromium' | 'firefox' | 'webkit';
export type Result = 'pass' | 'fail' | 'skip';
export type Coverage = { lines: number; branches: number; functions: number; statements?: number };
export type Tally = { pass: number; fail: number; skip: number };

export type PackageSummary = {
	tests: number;
	byKind: Partial<Record<Kind, number>>;
	coverage: Coverage;
	srcLines: number;
	testLines: number;
	fail: number;
};

export type Summary = {
	version: string;
	commit: string;
	date: string;
	/** The browser engines this report ran. */
	engines?: ('chromium' | 'firefox' | 'webkit')[];
	/** False while the end-to-end suites are not part of the report. */
	e2e?: boolean;
	totals: {
		tests: number;
		byKind: Record<Kind, number>;
		byEngine: Record<'chromium' | 'firefox' | 'webkit', Tally>;
		regression: number;
		seeded: number;
		benches: number;
		srcLines: number;
		testLines: number;
		ratio: number;
		coverage: Coverage & { statements: number };
	};
	packages: Record<string, PackageSummary>;
};

export type TestCase = {
	file: string;
	name: string;
	kind: Kind;
	results: Partial<Record<Engine, Result>>;
	issue?: number | string;
};

export type PackageReport = {
	tests: TestCase[];
};

export const KINDS: { id: Kind; label: string }[] = [
	{ id: 'unit', label: 'Unit' },
	{ id: 'browser', label: 'Browser' },
	{ id: 'e2e', label: 'End to end' },
	{ id: 'types', label: 'Type tests' },
	{ id: 'rules', label: 'Lint rules' }
];
export const ENGINES: { id: Engine; label: string }[] = [
	{ id: 'node', label: 'Node' },
	{ id: 'chromium', label: 'Chromium' },
	{ id: 'firefox', label: 'Firefox' },
	{ id: 'webkit', label: 'WebKit' }
];

/** `0.13.0` sorts above `0.12.4`, and a release above its own prereleases. */
export function compare_versions(a: string, b: string): number {
	const [ma, pa = ''] = a.split('-', 2);
	const [mb, pb = ''] = b.split('-', 2);
	const na = ma.split('.').map(Number);
	const nb = mb.split('.').map(Number);
	for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return nb[i] - na[i];
	if (pa === pb) return 0;
	if (!pa) return -1;
	if (!pb) return 1;
	return pb.localeCompare(pa, 'en', { numeric: true });
}

/** The URL segment for a package: `@ogygia/core` is `core`. */
export const slug_of = (name: string) => name.replace(/^@ogygia\//, '');

/** The report file for a package: `@ogygia/core` is `ogygia-core.json`. */
export const file_of = (name: string) => `${name.replace(/^@/, '').replace('/', '-')}.json`;

/**
 * One row per test: a test that runs in Node and in the browsers is one entry per run in the
 * report, and one row here with a result in each engine.
 */
export type Row = {
	file: string;
	name: string;
	kinds: Kind[];
	results: Partial<Record<Engine, Result>>;
	issue?: number | string;
};

export function rows(tests: TestCase[]): Row[] {
	const out = new Map<string, Row>();
	for (const t of tests) {
		const key = `${t.file}\0${t.name}`;
		const row = out.get(key);
		if (!row) {
			out.set(key, {
				file: t.file,
				name: t.name,
				kinds: [t.kind],
				results: { ...t.results },
				issue: t.issue
			});
			continue;
		}
		if (!row.kinds.includes(t.kind)) row.kinds.push(t.kind);
		Object.assign(row.results, t.results);
		row.issue ??= t.issue;
	}
	return [...out.values()];
}

export const percent = (n: number) => `${n.toFixed(1)}%`;
export const count = (n: number) => n.toLocaleString('en-US');

export function issue_href(issue: number | string): string {
	const s = String(issue);
	return /^https?:\/\//.test(s)
		? s
		: `https://github.com/ogygiajs/ogygia/issues/${s.replace(/^#/, '')}`;
}
export const issue_label = (issue: number | string) =>
	/^https?:\/\//.test(String(issue)) ? 'issue' : `#${String(issue).replace(/^#/, '')}`;
