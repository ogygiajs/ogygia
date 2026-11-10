// A keyed flights whose key field holds a symbol made at run time (one per request, say): once the
// key is dropped and nothing holds the symbol, it is freed. Prints `freed` or `held`.
// Run with --expose-gc.
import { flights } from '../../src/index.ts';

const gc = (globalThis as { gc?: () => void }).gc!;
const asks = flights.keyed<{ who: symbol }>()({ key: ['who'], run: async () => 1, keep: 0 });
let refs: WeakRef<symbol>[] = [];
async function one(): Promise<void> {
	const who = Symbol('request');
	refs.push(new WeakRef(who));
	await asks.get({ who });
}
for (let i = 0; i < 100; i++) await one();
for (let i = 0; i < 3; i++) {
	gc();
	await new Promise((r) => setTimeout(r, 10));
}
const held = refs.filter((r) => r.deref() !== undefined).length;
refs = [];
console.log(held === 0 ? 'freed' : `held ${held}`);
