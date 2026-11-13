// A BATCH HOLE STREAM THE VISITOR LEFT (#245): the batch's frame stream (server/stream-regions.ts
// `batch_stream`) renders its calls through the server's render gate (runtime/concurrency.ts). When
// the client goes away its response body is cancelled: the calls not started yet must never start
// (and never take or keep a slot), and the renders already running end quietly, their late writes
// dropped. A real ReadableStream, a real gate, real timers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { batch_stream, type BatchAnswer } from '../src/server/stream-regions.ts';
import { ConcurrencyGate } from '../src/runtime/concurrency.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Holes rendered through `gate`: the first takes `first_ms`, the others `ms`. */
function holes(gate: ConcurrencyGate, first_ms: number, ms: number) {
	const started: string[] = [];
	const ended: string[] = [];
	const render = (endpoint: string, signal?: AbortSignal): Promise<BatchAnswer> =>
		gate.run(
			async () => {
				started.push(endpoint);
				await sleep(endpoint === 'h0' ? first_ms : ms);
				ended.push(endpoint);
				return { slot: endpoint, html: `<p>${endpoint}</p>` };
			},
			{ signal }
		);
	return { render, started, ended };
}

afterEach(() => vi.restoreAllMocks());

describe('batch_stream: a cancelled batch (#245)', () => {
	it('cancelled after its first hole: the holes not started never start, and no late write throws', async () => {
		const enqueue = vi.spyOn(ReadableStreamDefaultController.prototype, 'enqueue');
		const gate = new ConcurrencyGate(2);
		const h = holes(gate, 5, 40);
		const calls = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5'];
		const reader = batch_stream(calls, h.render).getReader();

		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain('<p>h0</p>');
		const before = [...h.started]; // h0, h1, and the hole h0's slot went to
		await reader.cancel(); // the visitor left

		// the holes still waiting give their place in the queue back at once
		expect(gate.waiting).toBe(0);
		await sleep(120); // long after every render would have ended
		expect(h.started).toEqual(before);
		expect(h.started.length).toBeLessThan(calls.length);
		expect(h.ended).toEqual(before); // the ones already running ran to their end …
		expect(gate.active).toBe(0); // … and gave their slots back
		// … and nothing was written after the cancel, so nothing threw
		expect(enqueue.mock.results.filter((r) => r.type === 'throw')).toEqual([]);
	});

	it('cancelled before any hole answers: only the holes that took a slot ever run', async () => {
		const gate = new ConcurrencyGate(2);
		const h = holes(gate, 30, 30);
		const stream = batch_stream(['h0', 'h1', 'h2', 'h3'], h.render);
		await sleep(5);
		await stream.cancel();
		await sleep(80);
		expect(h.started).toEqual(['h0', 'h1']);
		expect(gate.waiting).toBe(0);
		expect(gate.active).toBe(0);
	});

	it('read to its end, it answers every call and the done sentinel', async () => {
		const gate = new ConcurrencyGate(2);
		const h = holes(gate, 5, 10);
		const text = await new Response(batch_stream(['h0', 'h1', 'h2'], h.render)).text();
		for (const id of ['h0', 'h1', 'h2']) expect(text).toContain(`<p>${id}</p>`);
		expect(text).toContain('__ogygia_done__');
		expect(gate.active).toBe(0);
	});
});

describe('ConcurrencyGate: a call whose signal aborts (#245)', () => {
	it('an aborted waiter leaves the queue at once, never runs, and frees nothing', async () => {
		const gate = new ConcurrencyGate(1);
		let ran = 0;
		const held = gate.run(() => sleep(30));
		const leave = new AbortController();
		const waiting = gate.run(
			async () => {
				ran++;
			},
			{ signal: leave.signal }
		);
		const caught = waiting.catch((e: unknown) => e);
		expect(gate.waiting).toBe(1);
		leave.abort();
		expect(gate.waiting).toBe(0);
		expect(await caught).toBe(leave.signal.reason);
		await held;
		expect(ran).toBe(0);
		expect(gate.active).toBe(0); // the held slot came back, and nobody kept one it never had
		await expect(gate.run(async () => 'next')).resolves.toBe('next');
	});

	it('a call made with an aborted signal never takes a slot, even a free one', async () => {
		const gate = new ConcurrencyGate(1);
		const gone = AbortSignal.abort();
		let ran = false;
		await expect(gate.run(async () => void (ran = true), { signal: gone })).rejects.toBe(
			gone.reason
		);
		expect(ran).toBe(false);
		expect(gate.active).toBe(0);
	});

	it('a call made with an aborted signal on a full gate rejects at once and never joins the queue', async () => {
		const gate = new ConcurrencyGate(1);
		const held = gate.run(() => new Promise<void>(() => {}));
		const gone = AbortSignal.abort();
		let ran = false;
		const outcome = gate
			.run(async () => void (ran = true), { signal: gone })
			.then(
				() => 'ran',
				(e: unknown) => e
			);
		await sleep(5);
		expect(gate.waiting).toBe(0);
		expect(await Promise.race([outcome, sleep(20).then(() => 'still waiting')])).toBe(gone.reason);
		expect(ran).toBe(false);
		void held;
	});

	it('a waiter whose signal aborts in the step it is handed a slot never runs, and gives the slot back', async () => {
		const gate = new ConcurrencyGate(1);
		let done!: () => void;
		const first = new Promise<void>((resolve) => (done = resolve));
		const held = gate.run(() => first);
		const leave = new AbortController();
		let ran = false;
		const waiting = gate.run(async () => void (ran = true), { signal: leave.signal });
		const caught = waiting.catch((e: unknown) => e);
		await new Promise((r) => setTimeout(r, 0));
		void first.then(() => leave.abort());
		done();
		await held;
		expect(await caught).toBe(leave.signal.reason);
		expect(ran).toBe(false);
		expect(gate.active).toBe(0);
		await expect(gate.run(async () => 'next')).resolves.toBe('next');
	});
});
