// The runtime's DOM-free work, run in Node: the fingerprint and signature hashes, the JSON lane of
// a props sidecar, the page cache, the region element's machines, the frame store's shared fetches,
// and the keyed body morph of a navigation against the unit tests' DOM shim
// (packages/core/test/_stubs/dom.ts; the shim's own work counts too).
//
// Hydration (the region element's boot and wake, hydrate_island, the scheduler) runs the same way in
// hydrate.bench.ts. The rest of the browser-only runtime (the router's navigation, the frame and lake
// stores, interaction replay) needs more of a real document and waits for Heisenbench's browser
// coverage.
import { el, frag } from '../test/_stubs/dom.ts';
import { bench } from '@bench/heisenbench/bench';
import { fingerprint_of, fnv1a, signature_of } from '../src/contract/hash.ts';
import { morph_children } from '../src/runtime/morph.ts';
import { parse_wire_text } from '../src/runtime/wire-format.ts';
import {
	import_again,
	is_failed_import,
	on_reload_needed,
	retry_url
} from '../src/runtime/import-again.ts';
import { ERRORS } from '../src/messages/core.ts';
import { create_navigation } from '../src/runtime/navigation.ts';
import { create_soft_refresh } from '../src/runtime/soft-refresh.ts';
import { ConcurrencyGate, is_run_timeout } from '../src/runtime/concurrency.ts';
import { SERVER_WARNINGS } from '../src/messages/server.ts';
import {
	create_answer,
	create_hole,
	create_live,
	create_paint,
	create_wake
} from '../src/runtime/region-machines.ts';
import * as frames from '../src/runtime/frame-store.ts';
import { mailbox, scope, STALE } from '@ogygia/machine';
import type { IslandHandle } from '../src/runtime/hydrate-core.ts';
import { block, header } from './fixtures.ts';

bench(
	'concurrency gate: hole renders through a gate of four (some slow, some past their time)',
	async ({ n }) => {
		const gate = new ConcurrencyGate(4);
		const calls: Promise<number>[] = [];
		for (let i = 0; i < n; i++) {
			const ms = i % 7 === 0 ? 50 : i % 3; // one in seven runs past its time
			const fails = i % 5 === 0; // one in five throws (a hole whose render fails)
			calls.push(
				gate
					.run(
						() =>
							new Promise<number>((resolve, reject) =>
								setTimeout(() => (fails ? reject(new Error('render')) : resolve(i)), ms)
							),
						// one in eleven has almost no time: it gives up waiting, or is abandoned
						{ deadline_ms: i % 11 === 0 ? 1 : 20 }
					)
					.catch((e: unknown) => (is_run_timeout(e) ? -2 : -1))
			);
		}
		const out = await Promise.all(calls);
		// the abandoned ones still end (they hold no slot by then)
		await new Promise((r) => setTimeout(r, 60));
		// (and the warning the endpoint logs when the first is abandoned)
		const said = SERVER_WARNINGS.region_render_abandoned;
		return (
			out.filter((v) => v < 0).length +
			gate.active +
			gate.waiting +
			gate.abandoned +
			said.text({ ms: 20 }).length +
			said.details().length
		);
	},
	{ setup: () => ({ n: 120 }), scale: (_ctx, k) => ({ n: 120 * k }) }
);

bench(
	'import_again: chunks that failed to download, asked for again under fresh URLs',
	async ({ chunks }) => {
		let loaded = 0;
		for (const url of chunks) {
			// each chunk's first download fails as Chromium reports it; the retry gets a fresh URL
			const load = import_again(
				() => Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${url}`)),
				async (fresh) => fresh,
				url
			);
			try {
				await load();
			} catch {
				// the first attempt: the failure the caller sees (its flight then calls again)
			}
			const fresh = (await load()) as string;
			if (fresh === retry_url(url, 1)) loaded++;
			// a message that names no URL (Safari) is read as a failed download too
			if (is_failed_import(new TypeError('Importing a module script failed.'))) loaded++;
		}
		return loaded;
	},
	{
		setup: () => ({
			chunks: Array.from(
				{ length: 40 },
				(_, i) => `https://shop.test/_app/immutable/chunks/C${i.toString(36)}hunk.js?v=${i}`
			)
		}),
		scale: (ctx, k) => ({
			chunks: Array.from({ length: k }, () => ctx.chunks).flat()
		})
	}
);

bench(
	'the reload messages: a chunk no retry loads, a runtime that did not load',
	({ urls }) => {
		let n = 0;
		// the boot hands import-again its message (said once per page)
		on_reload_needed((url) => (n += url.length));
		const chunk = ERRORS.chunk_reload_needed;
		const runtime = ERRORS.runtime_load_failed;
		for (const url of urls) n += chunk.text({ url }).length;
		return n + chunk.details().length + runtime.text().length + runtime.details().length;
	},
	{
		setup: () => ({
			urls: Array.from(
				{ length: 40 },
				(_, i) => `https://shop.test/_app/immutable/chunks/C${i.toString(36)}hunk.js?og-retry=1`
			)
		}),
		scale: (ctx, k) => ({ urls: Array.from({ length: k }, () => ctx.urls).flat() })
	}
);

bench(
	'fnv1a: fingerprints of twenty CMS blocks',
	({ texts }) => {
		let n = 0;
		for (const t of texts) n += fingerprint_of('/_app/ogygia/og-region.e.js', '', t).length;
		return n;
	},
	{
		setup: () => ({ texts: Array.from({ length: 20 }, (_, i) => JSON.stringify(block(i))) }),
		scale: (ctx, k) => ({ texts: ctx.texts.map((t) => t.repeat(k)) })
	}
);

bench(
	'signature_of + fnv1a: a hole endpoint per region',
	({ endpoints }) => {
		let n = 0;
		for (const e of endpoints)
			n += signature_of('/_app/ogygia/og-region.e.js', e).length + fnv1a(e).length;
		return n;
	},
	{
		setup: () => ({
			endpoints: Array.from(
				{ length: 200 },
				(_, i) => `/__ogygia__/r?id=${i.toString(16)}&p=${'eyJibG9jayI6'.repeat(20)}&k=${i}`
			)
		})
	}
);

bench(
	'parse_wire_text: the header config’s JSON-lane sidecar',
	({ text }) => parse_wire_text(text, true),
	{ setup: () => ({ text: JSON.stringify(header()) }) }
);

bench(
	"the router's machines: clicks that take over a navigation in flight, and soft refreshes it ends",
	async ({ n }) => {
		const nav = create_navigation();
		const soft = create_soft_refresh();
		let arrived = 0;
		for (let i = 0; i < n; i++) {
			// a soft refresh out when the visitor clicks: the navigation ends it
			soft.go('refreshing', { href: '/a' });
			const refresh = soft.scope.task(async () => 'the page refreshed');
			nav.go('claimed', { href: `/p${i}` });
			const mine = nav.now;
			if (soft.now.kind === 'refreshing') soft.go('idle');
			nav.go('loading', { href: `/p${i}` });
			const page = nav.scope.task(async () => `<h1>p${i}</h1>`);
			// every third click is taken over by a newer one while its page is out
			if (i % 3 === 0) nav.go('claimed', { href: `/p${i}b` });
			const [html] = await Promise.all([page, refresh]);
			if (typeof html !== 'string' || nav.now !== mine) {
				nav.go('idle');
				continue;
			}
			nav.go('settling', { href: `/p${i}` });
			nav.go('idle');
			arrived++;
		}
		return arrived;
	},
	{ setup: () => ({ n: 60 }), scale: (_ctx, k) => ({ n: 60 * k }) }
);

function list(keys: number[]): string {
	let out = '<ul class="results">';
	for (const k of keys)
		out += `<li data-key="r${k}"><a href="/p/${k}">Result ${k}</a><span class="price">${(k * 13) % 997}</span></li>`;
	return out + '</ul>';
}

bench(
	'morph: a navigation reorders, edits and trims a keyed list',
	({ parent, next }) => {
		morph_children(parent as unknown as Element, next as unknown as Node[]);
		return parent.childNodes.length;
	},
	{
		setup: () => {
			const keys = Array.from({ length: 300 }, (_, i) => i);
			// a filter: every third result gone, the rest reversed in blocks of ten, a few new ones
			const kept = keys.filter((k) => k % 3 !== 0);
			const next: number[] = [];
			for (let i = 0; i < kept.length; i += 10) next.push(...kept.slice(i, i + 10).reverse());
			next.push(1000, 1001, 1002);
			const parent = el(`<main>${list(keys)}</main>`);
			return { parent, next: frag(list(next)) };
		}
	}
);

bench(
	'region machines: holes fetch, retry and answer; their islands arm and wake; live regions switch modes',
	({ n }) => {
		let left = 0;
		const leave = () => void left++;
		const app: IslandHandle = { dispose: leave };
		for (let i = 0; i < n; i++) {
			const hole = create_hole();
			const answer = create_answer();
			const wake = create_wake();
			hole.go('armed', { attempts: 0 });
			hole.scope.defer(leave); // (a schedule's listener)
			hole.go('fetching', { attempts: 0, revalidate: false });
			if (i % 3 === 0) {
				// its fetch failed: it waits, re-arms, and tries again
				hole.go('retrying', { attempts: 1, revalidate: false });
				hole.go('armed', { attempts: 1 });
				hole.go('fetching', { attempts: 1, revalidate: false });
			}
			if (i % 7 === 0) {
				hole.go('failed');
				continue;
			}
			hole.go('idle');
			answer.go(i % 5 === 0 ? 'kept' : 'answered');
			if (answer.now.kind === 'kept') continue;
			wake.go('armed');
			wake.scope.defer(leave); // (the capture, handed on to `waking`)
			wake.go('waking');
			if (i % 11 === 0) wake.go('failed', { error: i });
			else wake.go('awake');
			wake.go('cold');
		}
		for (let i = 0; i < n / 4; i++) {
			const live = create_live();
			live.go('static');
			live.scope.defer(leave); // (its subscription)
			live.go('hydrating', { module: 'a' });
			live.go('live', { module: 'a', app });
			live.scope.defer(() => app.dispose());
			live.go('hydrating', { module: 'b' });
			live.go('idle');
		}
		// frames that wait for their sheets: a newer one takes over the older one's visit
		let painted = 0;
		for (let i = 0; i < n / 4; i++) {
			const paint = create_paint();
			paint.go('painting');
			const older = paint.now;
			paint.go('painting');
			if (paint.now !== older) painted++;
			paint.go('idle');
		}
		return left + painted;
	},
	{ setup: () => ({ n: 400 }), scale: (_ctx, k) => ({ n: 400 * k }) }
);

bench(
	'region mailbox: each region’s wake path through its mailbox (connect, schedule, six waits), frames landing while it waits, a quarter leaving mid-wake',
	async ({ n }) => {
		let ran = 0;
		const wakes: Promise<unknown>[] = [];
		for (let i = 0; i < n; i++) {
			const life = scope();
			const box = mailbox(life);
			// the connect and its schedule firing: turns that run at once on an idle box
			box.post(() => void ran++);
			box.post(() => void ran++);
			// the wake: the island's wait for its slot, its module, the kit page, a visitor's replay,
			// its scheduler turn and its snippets, each a wait that lets the element's other events in
			wakes.push(
				box.ask(async (turn) => {
					for (let w = 0; w < 6; w++) if ((await turn.wait(Promise.resolve(w))) === STALE) return;
					ran++;
				})
			);
			// a frame landing while it waits (a turn of its own, between two of the wake's)
			box.post(() => void ran++);
			if (i % 4 === 0) {
				// it leaves the page mid-wake: its wait is STALE, what it queued is dropped
				box.post(() => void ran++);
				queueMicrotask(() => life.close());
			}
		}
		await Promise.all(wakes);
		return ran;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

bench(
	'frame store: twin holes share one fetch per address, copies leave with their own signals, a renewal is the address’s',
	async ({ n }) => {
		frames._reset();
		const settled: Promise<string | typeof STALE>[] = [];
		for (let i = 0; i < n; i++) {
			const a = `h${i}|p`;
			const fetcher = () => Promise.resolve(`<p>${i}</p>`);
			if (i % 4 === 0) {
				// a batch reserved it: both copies join; one leaves; the batch delivers
				frames.reserve(a);
				const leave = new AbortController();
				const leaving = frames.ensure(a, fetcher, { signal: leave.signal });
				const twin = frames.ensure(a, fetcher);
				leave.abort();
				frames.write({ a, v: frames.ticket(a), html: `<p>batch ${i}</p>` });
				settled.push(leaving, twin);
				continue;
			}
			if (i % 4 === 2) {
				// a batch reserved it, a copy joined, and a refresh (forced) came: the batch ends without
				// its part every other time, and the copy goes to a fetch of its own
				frames.reserve(a);
				const joined = frames.ensure(a, fetcher);
				const refresh = frames.ensure(a, fetcher, { force: true });
				if (i % 8 === 2) frames.release(a);
				settled.push(
					joined.catch(() => frames.ensure(a, fetcher)),
					refresh
				);
				continue;
			}
			const first = frames.ensure(a, fetcher);
			const leave = new AbortController();
			const twin = frames.ensure(a, fetcher, { signal: leave.signal });
			if (i % 3 === 0) leave.abort();
			if (i % 5 === 0) frames.renew(a, `/__ogygia__?id=h${i}&props=p&exp=2&sig=new`);
			settled.push(first, twin);
		}
		const out = await Promise.all(settled);
		let renewed = 0;
		for (let i = 0; i < n; i++) if (frames.renewal(`h${i}|p`) !== null) renewed++;
		frames._reset();
		return out.filter((html) => html !== STALE).length * 1000 + renewed;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

bench(
	'frame store: answers written at each address, newer ones applied, older requests and older data dropped',
	({ n }) => {
		frames._reset();
		let applied = 0;
		for (let i = 0; i < n; i++) {
			const a = `w${i % 50}|p`;
			const t = frames.ticket(a);
			// a refresh, then the slower answer of the request before it (dropped)
			if (frames.write({ a, v: t, html: `<p>${i}</p>` })) applied++;
			if (frames.write({ a, v: t - 1, html: `<p>late ${i}</p>` })) applied++;
			// two commands' answers with data versions, decoded out of order (the older is dropped)
			if (i % 4 === 0) {
				if (frames.write({ a, v: frames.ticket(a), d: i + 2, html: `<p>v${i + 2}</p>` })) applied++;
				if (frames.write({ a, v: frames.ticket(a), d: i + 1, html: `<p>v${i + 1}</p>` })) applied++;
			}
		}
		let shown = 0;
		for (let i = 0; i < 50; i++) if (frames.peek(`w${i}|p`) !== null) shown++;
		frames._reset();
		return applied * 100 + shown;
	},
	{ setup: () => ({ n: 400 }), scale: (_ctx, k) => ({ n: 400 * k }) }
);
