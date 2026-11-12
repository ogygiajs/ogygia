// The simulator's own pieces keep their promise: one seed, one run.
import { describe, expect, it } from 'vitest';
import { rng } from '../src/rng.ts';
import { Loop } from '../src/loop.ts';
import { platform, EPOCH } from '../src/platform.ts';
import { client_address, Network, type FaultClass } from '../src/network.ts';

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

describe('a page request', () => {
	it("is not a file, Kit's remote functions, nor a region's answer, ogygia's or federation's", async () => {
		const { is_page_path } = await import('../src/world.ts');
		expect(['/', '/p4', '/p4/__data.json', '/peer/q0'].every(is_page_path)).toBe(true);
		for (const p of [
			'/_app/immutable/chunks/a.js',
			'/_app/remote/x/held1',
			'/__ogygia__',
			'/og/frag',
			'/og/fragment/page'
		])
			expect(is_page_path(p)).toBe(false);
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

	it("a calm tab's request is never held long: its legs stay short under reorder", async () => {
		const loop = new Loop(rng(3));
		const net = new Network({
			loop,
			rng: rng(3),
			faults: new Set(['delay', 'reorder']),
			rates: { reorder: 1 }
		});
		net.calm('tab-9');
		let at = -1;
		void net
			.send('tab-9', new Request('https://app.test/'), async () => new Response('x'))
			.then((r) => r.text())
			.then(() => (at = loop.now));
		await loop.run();
		// (request leg, response leg, one chunk and the end, each at most 120 ms)
		expect(at).toBeGreaterThan(0);
		expect(at).toBeLessThanOrEqual(4 * 120);
	});

	it('a stalled answer comes 10 to 40 s late, and the exchange says it stalled; a calm one never', async () => {
		// (a batch's stream gives up after 10 s with no answer, `batch-stream` -> stalled; legs top
		// out at 3 s, so no run saw it)
		const loop = new Loop(rng(4));
		const net = new Network({ loop, rng: rng(4), faults: new Set(['stall']), rates: { stall: 1 } });
		net.calm('tab-9');
		const at: Record<string, number> = {};
		for (const tab of ['tab-1', 'tab-9'])
			void net
				.send(`${tab}#1`, new Request('https://app.test/'), async () => new Response('x'))
				.then((r) => r.text())
				.then(() => (at[tab] = loop.now));
		await loop.run();
		expect(at['tab-1']).toBeGreaterThanOrEqual(10_000);
		expect(at['tab-1']).toBeLessThanOrEqual(40_010);
		expect(at['tab-9']).toBeLessThan(100);
		const by = Object.fromEntries(net.exchanges.map((e) => [e.from, e.stalled === true]));
		expect(by).toEqual({ 'tab-1#1': true, 'tab-9#1': false });
	});

	it('some stalls come midway: the head arrives on time and the body goes quiet 10 to 40 s', async () => {
		// (a batch stream that started reading and then went quiet, `batch-stream: reading -> stalled`:
		// a stall only ever held an answer's start)
		const loop = new Loop(rng(6));
		const net = new Network({ loop, rng: rng(6), faults: new Set(['stall']), rates: { stall: 1 } });
		const body = () =>
			new ReadableStream<Uint8Array>({
				start(c) {
					c.enqueue(new TextEncoder().encode('a'));
					c.enqueue(new TextEncoder().encode('b'));
					c.close();
				}
			});
		const seen: Array<{ head: number; whole: number }> = [];
		for (let i = 0; i < 12; i++)
			void net
				.send(`tab-1#1`, new Request(`https://app.test/r/${i}`), async () => new Response(body()))
				.then(async (r) => {
					const head = loop.now;
					expect(await r.text()).toBe('ab');
					seen.push({ head, whole: loop.now });
				});
		await loop.run();
		expect(seen).toHaveLength(12);
		const midway = seen.filter((s) => s.head < 10_000);
		const held = seen.filter((s) => s.head >= 10_000);
		expect(midway.length).toBeGreaterThan(0);
		expect(held.length).toBeGreaterThan(0);
		for (const s of midway) expect(s.whole - s.head).toBeGreaterThanOrEqual(10_000);
		for (const s of seen) expect(s.whole).toBeLessThanOrEqual(41_000);
		expect(net.exchanges.every((e) => e.stalled === true)).toBe(true);
	});

	it("a calm tab's request comes from a client address of its own (gen 78, seed 78013)", async () => {
		// (the reference load met the rate limit the run's own hole retries had used up, got 429
		// for its holes and showed their fallbacks)
		const loop = new Loop(rng(1));
		const net = new Network({ loop, rng: rng(1), faults: new Set() });
		net.calm('tab-9');
		const seen: Record<string, string> = {};
		for (const tab of ['tab-1', 'tab-9'])
			void net.send(`${tab}#1`, new Request('https://app.test/'), async () => {
				seen[tab] = client_address();
				return new Response('x');
			});
		await loop.run();
		expect(seen['tab-1']).toBeDefined();
		expect(seen['tab-9']).toBeDefined();
		expect(seen['tab-9']).not.toBe(seen['tab-1']);
	});

	it("a server's hop names the document whose request it was answering", async () => {
		const loop = new Loop(rng(1));
		const net = new Network({ loop, rng: rng(1), faults: new Set() });
		const peer = async () => new Response('peer');
		void net.send('tab-1#2', new Request('https://app.test/p'), async () => {
			const hop = await net.send('server-0', new Request('https://peer.test/f'), peer);
			return new Response(await hop.text());
		});
		await loop.run();
		expect(net.exchanges.map((e) => [e.from, e.for])).toEqual([
			['tab-1#2', undefined],
			['server-0', 'tab-1#2']
		]);
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
