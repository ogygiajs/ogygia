// The server's hole work around a render: the cache's one flight per key (a burst of one cached
// hole renders it once), a batch's frame stream (read to its end, or cancelled when its visitor
// leaves), the request's end (the work plugins leave running, kept alive past the response), and the
// app's plugins started again by dev edits.
import { bench } from '@bench/heisenbench/bench';
import { ConcurrencyGate } from '../src/runtime/concurrency.ts';
import { cached_render, render_cache_clear, render_cache_key } from '../src/server/render-cache.ts';
import { batch_stream, type BatchAnswer } from '../src/server/stream-regions.ts';
import {
	end_request,
	start_app_plugins,
	type AppSigner,
	type LivePlugin,
	type ServerPluginEntry
} from '../src/plugin/server.ts';
import { ask, notify } from '../src/plugin/hooks.ts';
import { facts_of } from '../src/plugin/facts.ts';
import { observe_reads, open_reads } from '../src/plugin/reads.ts';
import type { RequestContext, ServerApp } from '../src/plugin/index.ts';
import { ref_names, set_ref_names_reader } from '../src/ref.ts';
import { __register_transportable, wire } from '../src/live-transport.ts';
import { hole_identity } from '../src/server/props-wire.ts';

/** A wired instance a hole's props can hold (a ref: named by its place, #816). */
class BenchBadge {
	label: string;
	constructor(label = '') {
		this.label = label;
	}
	static [wire] = {
		encode: (b: BenchBadge) => b.label,
		decode: (label: string) => new BenchBadge(label)
	};
}
__register_transportable('bench/badge.ts#BenchBadge', BenchBadge);

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
			const render = (signal?: AbortSignal) =>
				gate.run(
					async () => {
						renders++;
						await tick();
						if (hole === 7) throw new Error('upstream down');
						return `<p>${hole}</p>`;
					},
					{ signal }
				);
			calls.push(
				cached_render(render, cache, undefined, leave).then(
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

bench(
	'render cache: anonymous visitors of a hole that reads their cookies, a header, locals and the page each render their own',
	async ({ n }) => {
		render_cache_clear();
		let bytes = 0;
		for (let i = 0; i < n; i++) {
			const request = new Request('http://x/_ogygia/region', {
				headers: { 'accept-language': i % 2 ? 'fr' : 'en' }
			});
			const jar: Record<string, string> = i % 4 === 0 ? {} : { vid: `v${i}` };
			const event = {
				request,
				cookies: {
					get: (name: string) => jar[name],
					getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value }))
				},
				locals: { user: i % 3 ? { id: i } : {} } as Record<string, unknown>
			};
			observe_reads(event as never, facts_of(request).reads);
			const html = await cached_render(
				() => {
					const vid = event.cookies.get('vid');
					event.cookies.getAll();
					request.headers.get('accept-language');
					request.headers.get('host');
					void event.locals.user;
					open_reads()?.page();
					return `<p>${vid ?? 'anon'}</p>`;
				},
				{ key: render_cache_key('h', 'p', ''), ttl: 60 }
			);
			bytes += html?.length ?? 0;
		}
		render_cache_clear();
		return bytes;
	},
	{ setup: () => ({ n: 40 }), scale: (_ctx, k) => ({ n: 40 * k }) }
);

bench(
	"reads: a render that asks locals, fetches, the visitor's address, the platform and a copy of the request",
	async ({ n }) => {
		let seen = 0;
		const fetched: typeof fetch = async () => new Response('');
		for (let i = 0; i < n; i++) {
			const headers: Record<string, string> = { 'accept-language': 'en' };
			if (i % 2) headers.cookie = `vid=v${i}`;
			const request = new Request('http://app.example.com/page', { headers });
			const event = {
				url: new URL(request.url),
				request,
				cookies: { get: () => undefined, getAll: () => [] },
				locals: (i % 3 ? { user: { id: i } } : {}) as Record<string, unknown>,
				fetch: fetched,
				getClientAddress: () => '203.0.113.7',
				platform: {
					env: { KEY: 'k' },
					context: { waitUntil: () => {} },
					region: i % 2 ? 'eu' : ''
				}
			};
			observe_reads(event as never, facts_of(request).reads);
			seen += 'user' in event.locals ? 1 : 0;
			seen += Object.keys(event.locals).length;
			// its own origin, a subdomain, another site, and a URL Kit cannot fetch
			await event.fetch('/api/own');
			await event.fetch('https://cdn.app.example.com/x');
			await event.fetch('https://elsewhere.example.org/y');
			await event.fetch('http://[bad');
			event.getClientAddress();
			void event.platform.env.KEY;
			event.platform.context.waitUntil();
			void event.platform.region;
			seen += request.headers.has('cookie') ? 1 : 0;
			for (const [name] of request.headers) seen += name.length;
			const copy = request.clone();
			seen += copy.headers.get('cookie') ? 1 : 0;
		}
		return seen;
	},
	{ setup: () => ({ n: 40 }), scale: (_ctx, k) => ({ n: 40 * k }) }
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
		for (let i = 0; i < n; i++) end_request(plugins, ctxs, platforms[i % 3]);
		await Promise.all(handed);
		await tick(); // (the sends no platform kept run on by themselves)
		return handed.length;
	},
	{ setup: () => ({ n: 120 }), scale: (_ctx, k) => ({ n: 120 * k }) }
);

/** A signer for the plugins' apps (they only hold it: nothing here signs). */
const SIGNER = {
	sign: (message: string) => message,
	verify: (message: string, signature: string) => message === signature,
	deny: () => new Response(null, { status: 403 })
} as unknown as AppSigner;

// Dev edits run the handle module again: each run starts the app's plugins anew (new objects for
// the edited ones), and the run before leaves the shared hooks first, so `ask` answers from the
// current run and `notify` reaches each plugin once.
bench(
	"the app's plugins started again by n dev edits: each run's predecessor leaves the shared hooks",
	async ({ n, plugins }) => {
		let answered = 0;
		for (let run = 0; run < n; run++) {
			const entries: ServerPluginEntry[] = [];
			for (let p = 0; p < plugins; p++)
				entries.push({
					name: `p${p}`,
					options: undefined,
					server: {
						lastBuild: p === 0 ? () => `run ${run}` : undefined,
						invalidate: () => void answered++
					}
				});
			start_app_plugins(entries, SIGNER);
			if ((await ask.lastBuild('v')) === `run ${run}`) answered++;
		}
		await notify.invalidate(['p:/']);
		return answered;
	},
	{ setup: () => ({ n: 40, plugins: 6 }), scale: (_ctx, k) => ({ n: 40 * k, plugins: 6 }) }
);

bench(
	"a request's holes: each one's identity, a third holding a wired instance (named by its place in the hole's props)",
	({ n }) => {
		const names = ref_names();
		set_ref_names_reader(() => names);
		let out = '';
		try {
			for (let i = 0; i < n; i++) {
				const shared = new BenchBadge(`b${i}`);
				const props = i % 3 === 0 ? { a: shared, b: shared, id: i } : { id: i, label: `hole ${i}` };
				out = hole_identity(`/holes/h${i % 8}.js`, props);
			}
		} finally {
			set_ref_names_reader(null);
		}
		return out.length;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);
