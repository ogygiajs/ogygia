// The queries database (src/compiler/queries.ts) on its own: a deep chain of answers checked after
// an edit, and a database past its bound letting its oldest answers go.
import { bench } from '@bench/heisenbench/bench';
import { derived, input, queries } from '../src/compiler/queries.ts';

const DEPTH = 2_000;

function chain_world() {
	const cell = input(
		'cell',
		(k: string) => k,
		() => 0
	);
	const chain: ReturnType<typeof derived<number, number>> = derived(
		'chain',
		(n: number) => String(n),
		(cx, n: number) => (n === 0 ? cx.get(cell, 'a') : cx.get(chain, n - 1) + 1)
	);
	return { cell, chain };
}

bench('queries: a chain of answers two thousand deep, checked after each of three edits', () => {
	const { cell, chain } = chain_world();
	const db = queries('bench');
	for (let n = 0; n <= DEPTH; n++) db.get(chain, n);
	let sum = 0;
	db.set(cell, 'a', 1);
	sum += db.get(chain, DEPTH);
	db.set(cell, 'b', 1);
	sum += db.get(chain, DEPTH);
	db.set(cell, 'a', 2);
	return sum + db.get(chain, DEPTH);
});

bench('queries: a database bound to a hundred answers, read across three hundred', () => {
	const { cell, chain } = chain_world();
	const db = queries('bench', 100);
	let sum = 0;
	for (let round = 0; round < 3; round++) {
		db.set(cell, 'a', round);
		for (let n = 0; n < 300; n++) sum += db.get(chain, n);
	}
	return sum;
});
