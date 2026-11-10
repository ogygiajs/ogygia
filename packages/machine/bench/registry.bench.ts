// A registry's hot paths, as the runtime and the server use them: entries added under owners, walked,
// and let go (each by its removal, or all at once when their owner ends); and the keyed form's
// definitions set, set again by a module's next run, read, and walked.
import { bench } from '@bench/heisenbench/bench';
import { registry, scope } from '../src/index.ts';

const keys = (n: number): string[] => Array.from({ length: n }, (_, i) => 'def/' + i);

bench(
	'registry: add under an owner, walk, remove half, then the owner ends',
	(n) => {
		const owner = scope();
		const live = registry<number>();
		const removals: Array<() => void> = [];
		for (let i = 0; i < n; i++) removals.push(live.add(i, owner));
		let sum = 0;
		for (const v of live) sum += v;
		for (let i = 0; i < n; i += 2) removals[i]!();
		const left = live.size;
		owner.close();
		// an owner that already ended adds nothing
		live.add(-1, owner)();
		return sum + left + live.size;
	},
	{ setup: () => 200, scale: (_ctx, k) => 200 * k }
);

bench(
	'registry.keyed: a run sets every definition, the next run sets them again, then reads and walks',
	(ks) => {
		const defs = registry.keyed<string, number>();
		const first = scope();
		for (let i = 0; i < ks.length; i++) defs.set(ks[i]!, i, first);
		// the module's next run: the old run ends, each definition is set again under the new one
		const next = scope();
		first.close();
		for (let i = 0; i < ks.length; i++) defs.set(ks[i]!, i + 1, next);
		let found = 0;
		for (const k of ks) if (defs.has(k) && defs.get(k) !== undefined) found++;
		let sum = 0;
		for (const [, v] of defs.entries()) sum += v;
		for (const v of defs.values()) sum += v;
		const size = defs.size;
		defs.set('gone', 0, next)();
		next.close();
		// a run that already ended defines nothing
		defs.set('late', 0, next)();
		return found + sum + size + defs.size;
	},
	{ setup: () => keys(200), scale: (_ctx, k) => keys(200 * k) }
);
