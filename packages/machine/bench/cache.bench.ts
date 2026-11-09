// A cache's hot paths, as the runtime and the server use them: sets that fill it and push the least
// recently used out, gets that find (and touch) what it holds, and the eviction notices.
import { bench } from '@bench/heisenbench/bench';
import { cache, type Cache } from '../src/index.ts';

const keys = (n: number): string[] => Array.from({ length: n }, (_, i) => '/page/' + i);

function filled(n: number, max: number): { c: Cache<string, number>; keys: string[] } {
	const c = cache<string, number>({ max });
	const ks = keys(n);
	for (let i = 0; i < ks.length; i++) c.set(ks[i]!, i);
	return { c, keys: ks };
}

bench(
	'cache: set into a full cache (each set lets the least recently used go)',
	({ c, keys }) => {
		let kept = 0;
		for (const k of keys) if (c.set(k + '?again', 1)) kept++;
		return kept;
	},
	{
		setup: () => filled(200, 200),
		scale: (_ctx, k) => filled(200 * k, 200 * k)
	}
);

bench(
	'cache: get of every key it holds (each a use)',
	({ c, keys }) => {
		let found = 0;
		for (const k of keys) if (c.get(k) !== undefined) found++;
		return found;
	},
	{
		setup: () => filled(200, 200),
		scale: (_ctx, k) => filled(200 * k, 200 * k)
	}
);

bench(
	'cache: evict with a notice per value (a clear)',
	({ c }) => {
		let heard = 0;
		const noticed = cache<string, number>({
			max: c.size + 1,
			onEvict: () => void heard++
		});
		for (const [k, v] of c.entries()) noticed.set(k, v);
		noticed.clear();
		return heard;
	},
	{
		setup: () => filled(200, 200),
		scale: (_ctx, k) => filled(200 * k, 200 * k)
	}
);
