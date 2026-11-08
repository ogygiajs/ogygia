// The server's hole work around a render: the cache's one flight per key (a burst of one cached
// hole renders it once), a batch's frame stream (read to its end, or cancelled when its visitor
// leaves), and the request's end (the work plugins leave running, kept alive past the response).
import { bench } from '@bench/heisenbench/bench';
import { ConcurrencyGate } from '../src/runtime/concurrency.ts';
import { cached_render, render_cache_clear, render_cache_key } from '../src/server/render-cache.ts';
import { batch_stream, type BatchAnswer } from '../src/server/stream-regions.ts';
import { end_request, type LivePlugin } from '../src/plugin/server.ts';
import type { RequestContext, ServerApp } from '../src/plugin/index.ts';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

bench(
	'render cache: bursts of cached holes share one render (some fail, some requests leave)',
	async ({ n }) => {
		render_cache_clear();
		const gate = new ConcurrencyGate(4);
		let renders = 0;
		const calls: Promise<number>[] = [];
		for (let i = 0; i < n; i++) {
			const hole = i % 8; // eight holes, each asked for by a burst of requests
			const cache = { key: render_cache_key(`h${hole}`, 'p', ''), ttl: 60 };
			// one request in nine has left before its render got a slot
			const leave = i % 9 === 0 ? AbortSignal.abort() : undefined;
			const render = () =>
				gate.run(
					async () => {
						renders++;
						await tick();
						if (hole === 7) throw new Error('upstream down');
						return `<p>${hole}</p>`;
					},
					{ signal: leave }
				);
			calls.push(
				cached_render(render, cache, 0, undefined, leave).then(
					(html) => html?.length ?? 0,
					() => -1
				)
			);
		}
		const out = await Promise.all(calls);
		render_cache_clear();
		return renders * 1000 + out.filter((v) => v < 0).length;
	},
	{ setup: () => ({ n: 160 }), scale: (_ctx, k) => ({ n: 160 * k }) }
);

/** Holes rendered through `gate`, each answering after a tick. */
const hole_render =
	(gate: ConcurrencyGate) =>
	(endpoint: string, signal: AbortSignal): Promise<BatchAnswer> =>
		gate.run(
			async () => {
				await tick();
				return endpoint.endsWith('3') ? null : { slot: endpoint, html: `<p>${endpoint}</p>` };
			},
			{ signal }
		);

bench(
	'batch stream: batches read to their end, and batches their visitor leaves after one hole',
	async ({ batches }) => {
		const gate = new ConcurrencyGate(4);
		let bytes = 0;
		for (let b = 0; b < batches; b++) {
			const calls = Array.from({ length: 12 }, (_, i) => `b${b}h${i}`);
			const reader = batch_stream(calls, hole_render(gate)).getReader();
			if (b % 2 === 0) {
				for (let r = await reader.read(); !r.done; r = await reader.read()) bytes += r.value.length;
			} else {
				bytes += (await reader.read()).value?.length ?? 0;
				await reader.cancel(); // the visitor left: the holes still queued never render
			}
		}
		await tick();
		await tick();
		return bytes + gate.active + gate.waiting;
	},
	{ setup: () => ({ batches: 20 }), scale: (_ctx, k) => ({ batches: 20 * k }) }
);

const live = (done: () => void | Promise<void>): LivePlugin => ({
	def: { done },
	app: { name: 'p', options: undefined } as unknown as ServerApp<unknown>
});
const CTX = {} as RequestContext<unknown, unknown>;

bench(
	'request end: plugins that leave a send running, with and without a platform waitUntil',
	async ({ n }) => {
		const plugins = [
			live(() => {}),
			live(() => tick()),
			live(() => Promise.reject(new Error('send failed'))),
			live(() => {
				throw new Error('tail broke');
			})
		];
		const ctxs = plugins.map(() => CTX);
		const handed: Promise<unknown>[] = [];
		const platforms = [
			undefined,
			{ context: { waitUntil: (p: Promise<unknown>) => void handed.push(p) } },
			{ ctx: { waitUntil: (p: Promise<unknown>) => void handed.push(p) } }
		];
		let bytes = 0;
		for (let i = 0; i < n; i++) {
			const response = i % 4 === 3 ? null : new Response(i % 4 === 2 ? null : `page ${i}`);
			const kept = end_request(plugins, ctxs, platforms[i % 3], response);
			const out = kept === null ? response : await kept;
			if (out?.body) bytes += (await out.text()).length;
		}
		await Promise.all(handed);
		return bytes + handed.length;
	},
	{ setup: () => ({ n: 120 }), scale: (_ctx, k) => ({ n: 120 * k }) }
);
