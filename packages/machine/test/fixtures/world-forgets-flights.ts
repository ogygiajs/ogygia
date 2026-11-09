// Many flights made on one world and dropped without a dispose (one per request, say): once nothing
// holds them, they are collected, and the world forgets them. Prints how many it still hears.
// Run with --expose-gc.
import { flights, world } from '../../src/index.ts';

const gc = (globalThis as { gc?: () => void }).gc!;
const pages = world();
const kept = flights({ run: () => 'kept', world: pages });
await kept.get();
for (let i = 0; i < 2000; i++) await flights({ run: () => i, world: pages }).get();
for (let i = 0; i < 3; i++) {
	gc();
	await new Promise((r) => setTimeout(r, 10));
}
pages.bump();
const heard = (pages as unknown as { _watchers: Set<unknown> })._watchers.size;
// (the one still held hears the move: its kept answer went)
console.log(`${heard} ${kept.peek() === undefined ? 'dropped' : 'kept'}`);
