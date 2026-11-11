// THE CI LABELS (ci-labels.yml, and engines.yml / heisenbench.yml / pkg-pr-new.yml read the same
// answer): which of the opt-in job sets a pull request runs.
//
//   ci:engines  Firefox and WebKit (the e2e slices and the browser test projects)
//   ci:bench    Heisenbench and the unmeasured gate
//   ci:preview  pkg.pr.new
//   ci:full     all three
//
// A PR into main gets `ci:bench` and `ci:preview`. A change to the runtime, the router, the morph,
// hydration or restore gets `ci:engines`; a change to a bench or a hot path gets `ci:bench`. A stacked
// PR (its base is another PR's branch) earns none: its stack's PR into main runs them (ci-stack.ts). The labels
// a PR carries are its own to add or remove as well; this only adds.
//
//   node .github/scripts/ci-labels.ts           print the labels this PR earns
//   node .github/scripts/ci-labels.ts --apply   add them to the PR (`gh`, the job's token)
//   node .github/scripts/ci-labels.ts --has ci:engines   exit 0 when the PR carries or earns it
// Reads PR, BASE_REF and LABELS (the PR's labels, JSON) from the env. Run by plain node.
import { execFileSync } from 'node:child_process';
import { has_label, labels_for } from './ci-stack.ts';

/** The files a PR changes, from the GitHub API (paginated). */
function changed_files(pr: string): string[] {
	const out = execFileSync(
		'gh',
		['api', '--paginate', `repos/{owner}/{repo}/pulls/${pr}/files`, '--jq', '.[].filename'],
		{ encoding: 'utf8' }
	);
	return out.split('\n').filter(Boolean);
}

const pr = process.env.PR ?? '';
const base = process.env.BASE_REF ?? '';
const carried: string[] = JSON.parse(process.env.LABELS || '[]');
if (!pr) throw new Error('ci-labels: PR is not set');
const earned = labels_for(base, changed_files(pr));
const args = process.argv.slice(2);

if (args[0] === '--has') {
	process.exit(has_label(args[1] ?? '', base, carried, earned) ? 0 : 1);
}
const missing = earned.filter((l) => !carried.includes(l));
console.log(`earned: ${earned.join(', ') || 'none'}; to add: ${missing.join(', ') || 'none'}`);
if (args[0] === '--apply' && missing.length)
	execFileSync('gh', ['pr', 'edit', pr, '--add-label', missing.join(',')], { stdio: 'inherit' });
