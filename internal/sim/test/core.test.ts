// The simulator's own pieces keep their promise: one seed, one run.
import { describe, expect, it } from 'vitest';
import { rng } from '../src/rng.ts';
import { Loop } from '../src/loop.ts';
import { platform, EPOCH } from '../src/platform.ts';
import { Network, type FaultClass } from '../src/network.ts';

describe('rng', () => {
	it('gives the same stream for the same seed, and a fork by name is its own stream', () => {
		const a = rng(7);
		const b = rng(7);
		const xs = Array.from({ length: 50 }, () => a.int(1000));
		expect(Array.from({ length: 50 }, () => b.int(1000))).toEqual(xs);
		// drawing from one fork does not move another
		const c = rng(7);
		const net = c.fork('net');
		c.fork('loop').float();
		expect(net.float()).toBe(rng(7).fork('net').float());
	});
});

describe('the loop and a realm platform', () => {
	it('runs timers in due order, equal ones in the order they were set, on virtual time', async () => {
		const loop = new Loop(rng(1));
		const p = platform({ name: 'tab-1', loop, rng: rng(1) });
		const seen: string[] = [];
		p.setTimeout(() => seen.push('b'), 20);
		p.setTimeout(() => seen.push('a'), 10);
		p.setTimeout(() => seen.push('a2'), 10);
		const id = p.setTimeout(() => seen.push('never'), 15);
		p.clearTimeout(id);
		await loop.run();
		expect(seen).toEqual(['a', 'a2', 'b']);
		expect(loop.now).toBe(20);
		expect(p.Date.now()).toBe(EPOCH + 20);
		expect(p.performance!.now()).toBe(20);
		expect(p.outstanding()).toBe(0);
	});

	it('a skewed realm reads a skewed wall clock and an unskewed monotonic one', () => {
		const loop = new Loop(rng(1));
		const p = platform({ name: 'server-1', loop, rng: rng(1), skew: -3000 });
		expect(p.Date.now()).toBe(EPOCH - 3000);
		expect(new (p.Date as DateConstructor)().getTime()).toBe(EPOCH - 3000);
		expect(p.performance!.now()).toBe(0);
	});

	it('interleaves realms by the seed, and the same seed interleaves them the same way', async () => {
		const order = async (seed: number) => {
			const loop = new Loop(rng(seed));
			const seen: string[] = [];
			for (const name of ['tab-1', 'tab-2', 'tab-3']) {
				const p = platform({ name, loop, rng: rng(seed) });
				p.setTimeout(() => seen.push(name), 5);
			}
			await loop.run();
			return seen.join(',');
		};
		expect(await order(3)).toBe(await order(3));
		const orders = new Set<string>();
		for (let s = 0; s < 40; s++) orders.add(await order(s));
		expect(orders.size).toBeGreaterThan(1);
	});
});

describe('the network', () => {
	const run = async (seed: number, faults: FaultClass[]) => {
		const loop = new Loop(rng(seed));
		const net = new Network({
			loop,
			rng: rng(seed),
			faults: new Set(faults),
			rates: { drop: 0.3, cut: 0.3 }
		});
		const out: string[] = [];
		for (let i = 0; i < 6; i++)
			net
				.send(
					'tab-1',
					new Request(`https://app.test/r/${i}`),
					async (r) => new Response(`answer ${new URL(r.url).pathname}`)
				)
				.then((res) => res.text())
				.then(
					(t) => out.push(t),
					(e: Error) => out.push(`failed ${e.message}`)
				);
		await loop.run();
		return { out, log: loop.log.join('\n') };
	};

	it('answers every request on the loop, the same way for the same seed', async () => {
		const a = await run(11, ['delay', 'reorder', 'drop', 'cut']);
		const b = await run(11, ['delay', 'reorder', 'drop', 'cut']);
		expect(a).toEqual(b);
		expect(a.out).toHaveLength(6);
	});

	it('with no faults, every answer arrives whole', async () => {
		const { out } = await run(5, []);
		expect(out.sort()).toEqual([0, 1, 2, 3, 4, 5].map((i) => `answer /r/${i}`));
	});

	it('offline fails at once', async () => {
		const loop = new Loop(rng(1));
		const net = new Network({ loop, rng: rng(1), faults: new Set() });
		net.offline('tab-1', true);
		const p = net.send('tab-1', new Request('https://app.test/'), async () => new Response('x'));
		const settled = p.then(
			() => 'ok',
			(e: Error) => e.message
		);
		await loop.run();
		expect(await settled).toContain('offline');
	});
});
