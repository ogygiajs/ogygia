/**
 * SHRINKING A FAILING RUN: the fewest of its actions that still fail the same way. Delta debugging
 * (Zeller's ddmin) over the action list: split it in n parts, try it without each part (all at once,
 * the pool runs them side by side), keep the first that still fails, and split finer when none does,
 * until no single action can go. Then each action alone is tried once more without it (a last pass
 * ddmin's coarse splits can miss once the list is short).
 *
 * "The same way" is the finding's signature (src/ci.ts `signature`: its oracle and what it is about,
 * run-specific numbers out), so a shrink never trades the bug for another one.
 */
import { createHash } from 'node:crypto';

/** Whether a run of `items` still fails, for each of several candidates at once. */
export type Check<T> = (candidates: ReadonlyArray<readonly T[]>) => Promise<boolean[]>;

/** The smallest list ddmin finds that `check` still fails on, and how many runs it took. */
export async function ddmin<T>(
	items: readonly T[],
	check: Check<T>
): Promise<{ items: T[]; runs: number }> {
	let now = [...items];
	let n = 2;
	let runs = 0;
	while (now.length >= 2) {
		const size = Math.ceil(now.length / n);
		const parts = Array.from({ length: Math.ceil(now.length / size) }, (_, i) =>
			now.slice(i * size, (i + 1) * size)
		);
		const without = parts.map((_, i) => parts.filter((_, k) => k !== i).flat());
		const fails = await check(without);
		runs += without.length;
		const first = fails.indexOf(true);
		if (first !== -1) {
			now = without[first];
			n = Math.max(n - 1, 2);
			continue;
		}
		if (n >= now.length) break;
		n = Math.min(now.length, n * 2);
	}
	// (one by one, once more: each action without which it still fails goes)
	for (let i = now.length - 1; i >= 0 && now.length > 1; i--) {
		const without = now.filter((_, k) => k !== i);
		runs++;
		if ((await check([without]))[0]) now = without;
	}
	return { items: now, runs };
}

/** A file name for a finding: its oracle and a short hash of its signature. */
export function slug(oracle: string, signature: string): string {
	return `${oracle.replace(/[^\w]+/g, '-')}-${createHash('sha1').update(signature).digest('hex').slice(0, 6)}`;
}

/**
 * The regression test a shrunk run becomes (`internal/sim/test/found/<name>.test.ts`): it runs the
 * plan on the app and expects the finding gone. It fails while the bug stands, and is skipped when
 * the app on disk is not the one it was found on (a generated app's seed, from its plan.json).
 */
export function regression_test(o: {
	name: string;
	/** The app's directory, from the repository root (`apps/sim-gen`). */
	app: string;
	/** A generated app's seed (its plan.json), or null for a hand-written app. */
	gen: number | null;
	seed: number;
	plan: unknown;
	oracle: string;
	signature: string;
	detail: string;
	actions: readonly string[];
}): string {
	const about = o.detail.split('\n')[0].slice(0, 300).replace(/\*\//g, '* /');
	return `// FOUND BY THE SIMULATOR, shrunk to ${o.actions.length} action${o.actions.length === 1 ? '' : 's'} (written by \`pnpm sim --shrink\`):
// [${o.oracle}] ${about}
//
${o.actions.map((a, i) => `//   ${i + 1}. ${a}`).join('\n')}
//
// Replay: pnpm sim --app ../../${o.app} --plan <this plan as a file> --step ${o.actions.length}
// (Needs the app built for the simulator${o.gen === null ? '' : `: \`node src/gen.ts --seed ${o.gen}\`, then \`pnpm sim:builds --app ../../${o.app}\``}; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';

const APP = fileURLToPath(new URL('../../../../${o.app}', import.meta.url));
const GEN: number | null = ${o.gen};
const ready = ((): boolean => {
	const built = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'];
	if (!built.some((b) => existsSync(APP + b + '/server/index.js'))) return false;
	if (GEN === null) return true;
	const plan = APP + '/src/lib/gen/plan.json';
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === GEN;
})();

const SEED = ${o.seed};
const PLAN = ${JSON.stringify(o.plan)};

describe.skipIf(!ready)('found: ${o.name}', () => {
	it(${JSON.stringify(`no ${o.oracle} (${o.signature})`)}, async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(
			res.broken.filter((b) => signature(b) === ${JSON.stringify(o.signature)})
		).toEqual([]);
	}, 300_000);
});
`;
}
