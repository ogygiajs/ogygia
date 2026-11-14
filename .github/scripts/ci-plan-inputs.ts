// What the CI plan (ci-plan.ts) reads from a push before it asks turbo: kept apart so a test can ask.

/** The top-level entries format and lint read that turbo's check tasks do not hash: every entry of
 *  `git ls-tree HEAD` but the packages and apps (their check tasks' hashes cover them) and the
 *  changesets (neither format nor lint reads them). `internal/` stays: lint reads it (#1531). */
export function format_lint_inputs(ls_tree: string[]): string[] {
	return ls_tree.filter((l) => l && !/\t(packages|apps|\.changeset)$/.test(l));
}

/** How much a push runs: `'check'` (format and lint only), `'affected'` (what turbo says the change
 *  reaches, cache hits left out) or `'everything'` (every job, cache hits included). */
export type PlanScope = 'check' | 'affected' | 'everything';

/** A file the test graph itself reads that turbo does not hash as a task input: the workflows that
 *  run the tests, the CI scripts, turbo's own config. A change to one changes how every job runs,
 *  so only running every job exercises it (#1926). */
function graph_input(f: string): boolean {
	return (
		f === '.github/workflows/e2e.yml' ||
		f === '.github/workflows/e2e-slice.yml' ||
		f.startsWith('.github/scripts/') ||
		f === 'turbo.json'
	);
}

/** A file whose change needs no test run: a changeset, Markdown outside the docs site, the
 *  licence, or a workflow other than the ones that run the tests. */
function inert(f: string): boolean {
	return (
		f.startsWith('.changeset/') ||
		(f.endsWith('.md') && !f.startsWith('apps/docs/')) ||
		f === 'LICENSE' ||
		(f.startsWith('.github/') && !graph_input(f))
	);
}

/** What a pull request changing `changed` needs before turbo is asked: `'everything'` when it
 *  touches the test graph itself, `'check'` (format and lint, which read every file, and nothing
 *  heavier) when every file is inert, else `'affected'`. */
export function cheap_plan(changed: string[]): PlanScope {
	if (changed.some(graph_input)) return 'everything';
	return changed.every(inert) ? 'check' : 'affected';
}

/** The tasks of turbo's plan a job runs: on `'everything'` all of them, a cache hit too (its
 *  result was earned on the old graph); otherwise the ones that do not replay. */
export function to_run<T extends { status: string }>(tasks: T[], scope: PlanScope): T[] {
	return scope === 'everything' ? tasks : tasks.filter((t) => t.status !== 'HIT');
}

/** turbo's flags for a pull request's plan: `--affected`, unless every task is wanted. */
export function turbo_scope(scope: PlanScope): string[] {
	return scope === 'everything' ? [] : ['--affected'];
}
