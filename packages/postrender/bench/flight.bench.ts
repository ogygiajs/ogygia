// The stampede flights (registry.ts): cold requests for n pages each open a flight, joiners wait
// on it, an invalidation turns the ones still rendering stale, and each settles once (a late,
// second settle does nothing).
import { bench } from '@bench/heisenbench/bench';
import {
	begin_flight,
	invalidate,
	join_flight,
	reset_for_tests,
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
		const flights = Array.from({ length: n }, (_, i) => begin_flight(`/p/${i}`));
		const joined = flights.map((_, i) => join_flight(`/p/${i}`));
		for (let i = 0; i < n; i += 2) settle_flight(`/p/${i}`, flights[i], { stored: entry(i) });
		await invalidate('/somewhere/'); // the odd ones, still rendering, go stale
		for (let i = 1; i < n; i += 2) settle_flight(`/p/${i}`, flights[i], { stored: null });
		for (let i = 0; i < n; i++) settle_flight(`/p/${i}`, flights[i], { stored: null }); // late
		let stored = 0;
		for (const j of joined) if ((await j)?.stored) stored++;
		return stored;
	},
	{ setup: () => ({ n: 100 }), scale: (_ctx, k) => ({ n: 100 * k }) }
);
