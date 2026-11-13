// What the CI plan (ci-plan.ts) reads from a push before it asks turbo: kept apart so a test can ask.

/** The top-level entries format and lint read that turbo's check tasks do not hash: every entry of
 *  `git ls-tree HEAD` but the packages and apps (their check tasks' hashes cover them) and the
 *  changesets (neither format nor lint reads them). `internal/` stays: lint reads it (#1531). */
export function format_lint_inputs(ls_tree: string[]): string[] {
	return ls_tree.filter((l) => l && !/\t(packages|apps|\.changeset)$/.test(l));
}

/** A file whose change needs no test run: a changeset, Markdown outside the docs site, the
 *  licence, or a workflow other than the ones that run the tests. */
function inert(f: string): boolean {
	return (
		f.startsWith('.changeset/') ||
		(f.endsWith('.md') && !f.startsWith('apps/docs/')) ||
		f === 'LICENSE' ||
		(f.startsWith('.github/') &&
			f !== '.github/workflows/e2e.yml' &&
			f !== '.github/workflows/e2e-slice.yml' &&
			!f.startsWith('.github/scripts/ci-plan'))
	);
}

/** What a pull request changing `changed` needs before turbo is asked: `'check'` (format and lint,
 *  which read every file, and nothing heavier) when every file is inert, else `'all'`. */
export function cheap_plan(changed: string[]): 'check' | 'all' {
	return changed.every(inert) ? 'check' : 'all';
}
