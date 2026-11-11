// A TESTS-REPORT PR CARRIES THE REPORT AND NOTHING ELSE (e2e.yml's `plan` job, on a PR from a
// `chore/tests-report-*` branch, the release workflow's own: .github/workflows/tests-report.yml).
// That PR merges by itself once `ci ok` passes, so it must not be able to carry a changeset (which
// would start a release from it, and a release would make another report: a loop) or any code.
// Fails naming every changed file outside apps/docs/static/tests/. Run by plain node.
//
//   node .github/scripts/tests-report-only.ts <base sha>
import { execFileSync } from 'node:child_process';

const base = process.argv[2];
if (!base) {
	console.error('tests-report-only: the base sha is required');
	process.exit(1);
}
// --no-renames: a rename lists both paths, so moving code into the report folder still fails
const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', `${base}...HEAD`], {
	encoding: 'utf8'
})
	.split('\n')
	.filter(Boolean);
const outside = changed.filter((f) => !f.startsWith('apps/docs/static/tests/'));
if (outside.length) {
	console.error(
		`A tests-report PR may change only apps/docs/static/tests/**. It also changes:\n${outside
			.map((f) => `  ${f}`)
			.join('\n')}`
	);
	process.exit(1);
}
console.log(`tests-report PR: ${changed.length} file(s), all under apps/docs/static/tests/`);
