/**
 * ORDER IS AN INPUT. A disk lists a directory in whatever order its file system keeps, and a bundler
 * transforms modules in whatever order its graph walk and its workers reach them. Neither may change
 * what the compiler decides. `shuffled()` lists each directory in a seeded order; `permute()` gives
 * the transform order.
 */
import type { Fs } from '../../../packages/compiler/src/index.ts';

/** A small seeded generator (mulberry32): the same seed, the same orders. */
export function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** `xs` in a seeded order (Fisher-Yates). */
export function permute<T>(xs: readonly T[], next: () => number): T[] {
	const out = [...xs];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** `files`, each directory listed in a seeded order. */
export function shuffled(files: Fs, seed: number): Fs {
	const next = rng(seed);
	return {
		read: (abs) => files.read(abs),
		stat: (abs) => files.stat(abs),
		list(dir) {
			const l = files.list(dir);
			return l === null ? null : permute(l, next);
		}
	};
}
