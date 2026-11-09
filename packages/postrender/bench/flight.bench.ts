// The stampede flights (registry.ts): cold requests for n pages each open a flight, joiners wait
// on it, invalidations turn stale the ones still rendering a page they evict (one URL, a form post
// on a page, a subtree, a tag), and each settles once (a late, second settle does nothing).
import { bench } from '@bench/heisenbench/bench';
import {
	begin_flight,
	current_runtime,
	invalidate,
	invalidateWhere,
	invalidate_tags,
	join_flight,
	reset_for_tests,
	self_evict,
	settle_flight
} from '../src/registry.ts';
import type { PostrenderEntry } from '../src/types.ts';

const entry = (i: number): PostrenderEntry => ({
	kind: 'page',
	html: `<p>page ${i}</p>`,
	head_end: 0,
	headers: {},
	created: 0
});

bench(
	'postrender flights: n cold pages, joiners, an invalidation midway, each settled once',
	async ({ n }) => {
		reset_for_tests();
		const key = (i: number) => (i % 3 === 0 ? `/fr/p/${i}` : `/p/${i}`);
		const flights = Array.from({ length: n }, (_, i) => begin_flight(key(i)));
		const joined = flights.map((_, i) => join_flight(key(i)));
		for (let i = 0; i < n; i += 2) settle_flight(key(i), flights[i], { stored: entry(i) });
		// the odd ones are still rendering: each invalidation stales the ones it evicts
		await invalidate('/somewhere/'); // none
		await invalidate(key(1));
		self_evict(current_runtime(), key(5));
		await invalidateWhere({ prefix: '/fr/' }); // the /fr/ ones
		await invalidate_tags(['r:promo']); // the rest
		for (let i = 1; i < n; i += 2) settle_flight(key(i), flights[i], { stored: null });
		for (let i = 0; i < n; i++) settle_flight(key(i), flights[i], { stored: null }); // late
		let stored = 0;
		for (const j of joined) if ((await j)?.stored) stored++;
		return stored;
	},
	{ setup: () => ({ n: 100 }), scale: (_ctx, k) => ({ n: 100 * k }) }
);
