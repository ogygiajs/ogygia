// What a batch of holes states (runtime/frame-nav.ts), one claim at a time: where it ends, what it
// reads, what it times, what it says when it carried less than it was asked for, and how holes join.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	batch_times,
	read_parcel,
	send_batches,
	streamFrames
} from '../../src/runtime/frame-nav.ts';
import { _reset, is_idle, peek, subscribe } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';
import { build_parcel } from '../../src/server/stream-regions.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { slots } from '../../src/runtime/slots.ts';
import type { HoleBatchMissedEvent } from '../../src/contract/runtime-hooks.ts';

const ep = (sig: string) => `/__ogygia__?id=bbbbbbbbbbbb&props=${sig}&exp=9999999999&sig=${sig}`;
const STALL_MS = 10_000;
const enc = (s: string) => new TextEncoder().encode(s);

type Seen = { cancelled: boolean; aborted: boolean; bodies: string[] };
/** Batch answers: each request gets `chunks` (one per read), then the body ends, or stays open
 *  when `hold`. `status`, `redirected` and `url` as given. */
function answer(
	chunks: string[],
	o: { hold?: boolean; status?: number; redirected?: boolean; url?: string } = {}
): Seen {
	const seen: Seen = { cancelled: false, aborted: false, bodies: [] };
	vi.spyOn(window, 'fetch').mockImplementation(async (_input, init) => {
		seen.bodies.push(String(init?.body));
		init?.signal?.addEventListener('abort', () => (seen.aborted = true), { once: true });
		let i = 0;
		const res = new Response(
			new ReadableStream<Uint8Array>({
				pull(controller) {
					if (i < chunks.length) controller.enqueue(enc(chunks[i++]));
					else if (!o.hold) controller.close();
					else return new Promise(() => {});
				},
				cancel() {
					seen.cancelled = true;
				}
			}),
			{ status: o.status ?? 200, headers: { 'content-type': 'text/html' } }
		);
		if (o.redirected) Object.defineProperty(res, 'redirected', { value: true });
		if (o.url) Object.defineProperty(res, 'url', { value: o.url });
		return res;
	});
	return seen;
}

let missed: HoleBatchMissedEvent[] = [];
beforeEach(() => {
	missed = [];
	slots.hooks = { holeBatchMissed: (e) => void missed.push(e) };
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	slots.hooks = undefined;
	_reset();
});

test('the server’s end mark ends the batch, though its connection stays open', async () => {
	answer([build_parcel('e1', '<p>1</p>') + build_parcel('__ogygia_done__', '')], { hold: true });
	let ended = false;
	void streamFrames([ep('e1'), ep('e2')], 'page').then(() => (ended = true));
	await expect.poll(() => ended, { timeout: 1_000 }).toBe(true);
});

test('an answer that is not ok writes nothing, and its body is let go unread', async () => {
	const seen = answer([build_parcel('n1', '<p>1</p>')], { status: 500 });
	await streamFrames([ep('n1'), ep('n2')], 'page');
	expect(peek(frameAddress(ep('n1')))).toBeNull();
	expect(seen.cancelled).toBe(true);
	expect(missed.map((m) => [m.sent, m.delivered, m.status])).toEqual([[2, 0, 500]]);
});

test('a redirected batch is said as refused, with where it ended', async () => {
	answer([], { redirected: true, url: `${location.origin}/login` });
	await streamFrames([ep('r1'), ep('r2')], 'page');
	expect(missed).toHaveLength(1);
	expect(missed[0].refused).toBe('redirected');
	expect(missed[0].finalUrl).toBe(`${location.origin}/login`);
});

test('a 200 with no part at all is said as answered by a page', async () => {
	answer(['<!doctype html><p>a page</p>'], { url: `${location.origin}/__ogygia__` });
	await streamFrames([ep('d1'), ep('d2')], 'page');
	expect(missed.map((m) => m.refused)).toEqual(['document']);
});

test('a batch that carried every hole says nothing', async () => {
	answer([build_parcel('a1', '<p>1</p>') + build_parcel('a2', '<p>2</p>')]);
	await streamFrames([ep('a1'), ep('a2')], 'page');
	expect(missed).toEqual([]);
});

test('a batch whose page was left says nothing of what it did not carry', async () => {
	answer([build_parcel('l1', '<p>1</p>')], { hold: true });
	const done = streamFrames([ep('l1'), ep('l2')], 'page');
	await new Promise((r) => setTimeout(r, 50));
	runtime_session.reset();
	await done;
	expect(missed).toEqual([]);
});

test('a part is timed before it is written, so its hole reads its timing as it answers', async () => {
	answer([build_parcel('t1', '<p>1</p>') + build_parcel('t2', '<p>2</p>')]);
	const timed: unknown[] = [];
	const off = subscribe(frameAddress(ep('t1')), () => timed.push(batch_times(ep('t1'))));
	await streamFrames([ep('t1'), ep('t2')], 'page');
	off();
	expect(timed).toHaveLength(1);
	expect(timed[0]).toMatchObject({ size: 2 });
});

test('the timings of the newest 64 holes are kept', async () => {
	const many = Array.from({ length: 65 }, (_, i) => ep(`m${i}`));
	answer([many.map((_, i) => build_parcel(`m${i}`, `<p>${i}</p>`)).join('')]);
	await streamFrames(many, 'page');
	expect(batch_times(many[0])).toBeUndefined();
	expect(batch_times(many[1])).toBeDefined();
	expect(batch_times(many[64])).toBeDefined();
});

test('parts split over reads are each written once', async () => {
	answer([build_parcel('s1', '<p>1</p>'), build_parcel('s2', '<p>2</p>')]);
	const writes: string[] = [];
	const off = subscribe(frameAddress(ep('s1')), (f) => writes.push(f.html));
	await streamFrames([ep('s1'), ep('s2')], 'page');
	off();
	expect(writes).toEqual(['<p>1</p>']);
	expect(peek(frameAddress(ep('s2')))?.html).toBe('<p>2</p>');
	expect(missed).toEqual([]);
});

test('an opening the server does not write is stepped over, and the part after it read', () => {
	const odd = '<template data-ogygia-slot="x" data-other="1">no</template>';
	const p = read_parcel(odd + build_parcel('ok', '<p>ok</p>'), 0);
	expect(p?.slot).toBe('ok');
	expect(p?.html).toBe('<p>ok</p>');
});

test('a hole with no capability is not reserved for the batch', async () => {
	answer([build_parcel('c1', '<p>1</p>')], { hold: true });
	const bare = '/__ogygia__?id=bbbbbbbbbbbb&props=none';
	void streamFrames([bare, ep('c1')], 'page');
	expect(is_idle(frameAddress(bare))).toBe(true);
	expect(is_idle(frameAddress(ep('c1')))).toBe(false);
	runtime_session.reset();
});

test('the page left while the request is still out: the batch ends at once', async () => {
	vi.spyOn(window, 'fetch').mockImplementation(() => new Promise(() => {}));
	let ended = false;
	void streamFrames([ep('o1'), ep('o2')], 'page').then(() => (ended = true));
	await new Promise((r) => setTimeout(r, 20));
	runtime_session.reset();
	await expect.poll(() => ended, { timeout: 1_000 }).toBe(true);
});

test('the quiet time starts again when the answer starts and at each read that brings bytes', async () => {
	// (the machine's timers end through clearInterval: faked with the rest)
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
	const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
	let send!: (r: Response) => void;
	vi.spyOn(window, 'fetch').mockImplementation(() => new Promise<Response>((r) => (send = r)));
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
	const done = streamFrames([ep('q1'), ep('q2')], 'page');
	await wait(STALL_MS * 0.6);
	send(new Response(body, { status: 200 }));
	await wait(STALL_MS * 0.6);
	controller.enqueue(enc(build_parcel('q1', '<p>1</p>')));
	await wait(STALL_MS * 0.6);
	controller.enqueue(enc(build_parcel('q2', '<p>2</p>')));
	controller.close();
	await done;
	expect(peek(frameAddress(ep('q1')))?.html).toBe('<p>1</p>');
	expect(peek(frameAddress(ep('q2')))?.html).toBe('<p>2</p>');
});

test('holes join one batch of at most 32 per request, each hole once', async () => {
	const seen = answer([]);
	const list = Array.from({ length: 33 }, (_, i) => ep(`b${i}`));
	await send_batches([...list, list[0]], 'page');
	expect(seen.bodies.map((b) => (JSON.parse(b) as string[]).length)).toEqual([32, 1]);
});
