/**
 * The one source of chance in a run. Every choice the simulator makes (a delay, a drop, which ready
 * task runs next, a buggify point firing, the workload's next action) is drawn here, from the run's
 * seed, so a seed replays the run.
 *
 * Streams are forked by name (`rng.fork('net')`): each consumer draws from its own stream, so adding
 * a draw in one place does not move every choice after it in another. That keeps a shrunk run close
 * to the original, and an old seed meaningful after the simulator grows.
 */

/** splitmix32: spreads a 32-bit seed into well-mixed state words. */
function splitmix32(a: number): () => number {
	return () => {
		a = (a + 0x9e3779b9) | 0;
		let t = a ^ (a >>> 16);
		t = Math.imul(t, 0x21f0aaad);
		t ^= t >>> 15;
		t = Math.imul(t, 0x735a2d97);
		return (t ^ (t >>> 15)) >>> 0;
	};
}

/** FNV-1a of a name, for a fork's seed. */
export function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

export interface Rng {
	/** The seed this stream was made from. */
	readonly seed: number;
	/** A float in [0, 1). */
	float(): number;
	/** An integer in [0, n). */
	int(n: number): number;
	/** An integer in [lo, hi]. */
	between(lo: number, hi: number): number;
	/** True with probability `p`. */
	chance(p: number): boolean;
	/** One of `items`. */
	pick<T>(items: readonly T[]): T;
	/** One of `items`, by weight. */
	weighted<T>(items: ReadonlyArray<readonly [T, number]>): T;
	/** A new stream, named: the same name from the same seed is the same stream. */
	fork(name: string): Rng;
}

/** A stream from `seed` (sfc32, 2^128 period, fast, and the same on every platform). */
export function rng(seed: number): Rng {
	const mix = splitmix32(seed >>> 0);
	let a = mix();
	let b = mix();
	let c = mix();
	let d = mix();
	const next = (): number => {
		const t = (((a + b) | 0) + d) | 0;
		d = (d + 1) | 0;
		a = b ^ (b >>> 9);
		b = (c + (c << 3)) | 0;
		c = (c << 21) | (c >>> 11);
		c = (c + t) | 0;
		return t >>> 0;
	};
	const self: Rng = {
		seed: seed >>> 0,
		float: () => next() / 4294967296,
		int: (n) => (n <= 0 ? 0 : Math.floor(self.float() * n)),
		between: (lo, hi) => lo + self.int(hi - lo + 1),
		chance: (p) => p > 0 && self.float() < p,
		pick: (items) => items[self.int(items.length)],
		weighted: (items) => {
			let total = 0;
			for (const [, w] of items) total += w;
			let x = self.float() * total;
			for (const [item, w] of items) if ((x -= w) < 0) return item;
			return items[items.length - 1][0];
		},
		fork: (name) => rng((seed ^ hash(name)) >>> 0)
	};
	return self;
}
