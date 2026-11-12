// WHICH CI A PULL REQUEST RUNS, as plain functions (ci-labels.ts and ci-plan.ts read them; tested in
// ci-stack.test.ts). A STACKED PR (its base is another PR's branch) runs format, lint, check and size
// only: its opt-in sets and e2e run once, on its stack's PR into main (or with `ci:full`). A BATCHED
// PR (CI folded it into a ci/integration-* batch and labelled it `batched`) runs format, lint, check
// and size only, even with `ci:full`: the rest runs on the batch, and the PR lands only through the
// batch's green run, so its own `ci ok` is red while it carries the label (e2e.yml).

/** The label CI adds when it folds a PR into an integration batch, and removes when it pulls it out. */
export const BATCHED = 'batched';

/** The PR carries `batched`: its e2e and opt-in sets run on its batch, not on the PR. */
export function is_batched(carried: readonly string[]): boolean {
	return carried.includes(BATCHED);
}

const ENGINES_PATHS = [
	/^packages\/[^/]+\/src\/runtime\//,
	/^packages\/router\//,
	/(^|\/)[^/]*(morph|hydrate|restore)[^/]*$/i
];
const BENCH_PATHS = [
	/(^|\/)bench\//,
	/^packages\/core\/src\/runtime\//,
	/^packages\/core\/src\/server\//,
	/^packages\/machine\/src\//
];

/** The long-lived branches (AGENTS.md "How work lands"): a PR into one is never stacked. */
const LONG_LIVED = /^(main|latest|lts-.+)$/;

/** A PR into `base` is stacked on another PR. */
export function is_stacked(base: string): boolean {
	return !!base && !LONG_LIVED.test(base);
}

/** The labels a PR into `base` that changes `files` earns. */
export function labels_for(base: string, files: readonly string[]): string[] {
	const out = new Set<string>();
	if (is_stacked(base)) return [];
	if (base === 'main') {
		out.add('ci:bench');
		out.add('ci:preview');
	}
	if (files.some((f) => ENGINES_PATHS.some((re) => re.test(f)))) out.add('ci:engines');
	if (files.some((f) => BENCH_PATHS.some((re) => re.test(f)))) out.add('ci:bench');
	return [...out].sort();
}

/** `--has <want>`: the PR into `base` carries or earns `want`, or carries `ci:full`. */
export function has_label(
	want: string,
	base: string,
	carried: readonly string[],
	earned: readonly string[]
): boolean {
	if (is_batched(carried)) return false;
	// (a stacked PR earns nothing, but what its author added by hand still runs)
	const all = new Set([...carried, ...(is_stacked(base) ? [] : earned)]);
	return all.has(want) || all.has('ci:full');
}
