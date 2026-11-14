// The stampede flights (registry.ts): cold requests for n pages each open a flight, joiners wait
// on it, invalidations end the ones still rendering a page they evict (one URL, a form post on a
// page, a subtree, a tag: their joiners get STALE at once), and each settles once (a late, second
// settle does nothing).
import { bench } from '@bench/heisenbench/bench';
import { STALE } from '@ogygia/machine';
import {
	current_runtime,
	enter_flight,
	invalidate,
	invalidateWhere,
	invalidate_tags,
	reset_for_tests,
	self_evict,
	type Flight
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
		const flights = Array.from({ length: n }, (_, i) => {
			const entered = enter_flight(key(i));
			return 'opened' in entered ? entered.opened : null;
		}).filter((f): f is Flight => f !== null);
		const joined = flights.map((f) => {
			const entered = enter_flight(f.key);
			return 'joined' in entered ? entered.joined : Promise.resolve(STALE);
		});
		for (let i = 0; i < flights.length; i += 2) flights[i].settle({ stored: entry(i) });
		// the odd ones are still rendering: each invalidation ends the ones it evicts
		await invalidate('/somewhere/'); // none
		await invalidate(key(1));
		await self_evict(current_runtime(), key(5));
		await invalidateWhere({ prefix: '/fr/' }); // the /fr/ ones
		await invalidate_tags(['r:promo']); // the rest
		for (let i = 1; i < flights.length; i += 2) flights[i].settle({ stored: null });
		for (const f of flights) f.settle({ stored: null }); // late
		let stored = 0;
		for (const j of joined) {
			const outcome = await j;
			if (outcome !== STALE && outcome.stored) stored++;
		}
		return stored;
	},
	{ setup: () => ({ n: 100 }), scale: (_ctx, k) => ({ n: 100 * k }) }
);
