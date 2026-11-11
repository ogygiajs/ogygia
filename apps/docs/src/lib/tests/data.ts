import { error } from '@sveltejs/kit';

// The test report CI publishes for each release, as static JSON under /tests:
// /tests/index.json, /tests/<version>/summary.json and /tests/<version>/<package>.json.
// Read at build time (the pages are prerendered), so a report is part of the deploy that shows it.

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
	coverage: { files: (Coverage & { path: string })[] };
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

const files = import.meta.glob<unknown>('/static/tests/**/*.json', { import: 'default' });

async function read<T>(path: string): Promise<T | undefined> {
	const load = files[`/static/tests/${path}`];
	return load ? ((await load()) as T) : undefined;
}

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

/** Every version with a report, newest first. */
export async function versions(): Promise<string[]> {
	const index = await read<string[] | { versions: (string | { version: string })[] }>('index.json');
	const list = Array.isArray(index) ? index : (index?.versions ?? []);
	return list.map((v) => (typeof v === 'string' ? v : v.version)).sort(compare_versions);
}

/** The newest version's report, or the named one. A version with no report is a 404. */
export async function summary(version?: string): Promise<{ summary: Summary; versions: string[] }> {
	const all = await versions();
	const v = version ?? all[0];
	const s = v && all.includes(v) ? await read<Summary>(`${v}/summary.json`) : undefined;
	if (!s) error(404, version ? `No test report for ${version}` : 'No test report yet');
	return { summary: s, versions: all };
}

/** The URL segment for a package: `@ogygia/core` is `core`. */
export const slug_of = (name: string) => name.replace(/^@ogygia\//, '');

export async function package_report(version: string, slug: string) {
	return read<PackageReport>(`${version}/${slug}.json`);
}

export const percent = (n: number) => `${Math.round(n * 10) / 10}%`;
export const count = (n: number) => n.toLocaleString('en-US');

export function issue_href(issue: number | string): string {
	const s = String(issue);
	return /^https?:\/\//.test(s)
		? s
		: `https://github.com/ogygiajs/ogygia/issues/${s.replace(/^#/, '')}`;
}
export const issue_label = (issue: number | string) =>
	/^https?:\/\//.test(String(issue)) ? 'issue' : `#${String(issue).replace(/^#/, '')}`;
