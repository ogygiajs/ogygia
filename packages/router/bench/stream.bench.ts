// The late chunks of a streamed document: late regions in completion order, and the regions that
// register as those chunks bake (a late region that holds another), until a take finds none.
import { bench } from '@bench/heisenbench/bench';
import { late_region_chunks, until_drained } from '../src/stream.ts';

type Late = { id: string; promise: Promise<unknown> };

const late = (id: string): Late => ({
	id,
	promise: Promise.resolve(`<p data-late="${id}">${id}</p>`)
});

bench(
	'until_drained: late regions that register more as they bake, until none is left',
	async ({ n }) => {
		// the document's own list, then one more region on each of the first `n` takes
		let left = n;
		const take = (): Late[] | null => (left > 0 ? [late(`r${left--}`)] : null);
		let chunks = 0;
		for await (const _chunk of until_drained(late_region_chunks([late('r0'), late('rx')]), take))
			chunks++;
		return chunks;
	},
	{ setup: () => ({ n: 40 }), scale: (_ctx, k) => ({ n: 40 * k }) }
);
