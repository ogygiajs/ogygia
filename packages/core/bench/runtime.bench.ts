// The runtime's DOM-free work, run in Node: the fingerprint and signature hashes, the JSON lane of
// a props sidecar, the page cache, and the keyed body morph of a navigation against the unit
// tests' DOM shim (packages/core/test/_stubs/dom.ts; the shim's own work counts too).
//
// Hydration (the region element's boot and wake, hydrate_island, the scheduler) runs the same way in
// hydrate.bench.ts. The rest of the browser-only runtime (the router's navigation, the frame and lake
// stores, interaction replay) needs more of a real document and waits for Heisenbench's browser
// coverage.
import { el, frag } from '../test/_stubs/dom.ts';
import { bench } from '@bench/heisenbench/bench';
import { fingerprint_of, fnv1a, signature_of } from '../src/runtime/hash.ts';
import { morph_children } from '../src/runtime/morph.ts';
import { PageCache } from '../src/runtime/page-cache.ts';
import { parse_wire_text } from '../src/runtime/wire-format.ts';
import { failed_import_url, import_again, retry_url } from '../src/runtime/import-again.ts';
import { create_navigation } from '../src/runtime/navigation.ts';
import { create_soft_refresh } from '../src/runtime/soft-refresh.ts';
import { ConcurrencyGate, is_run_timeout } from '../src/runtime/concurrency.ts';
import { SERVER_WARNINGS } from '../src/messages/server.ts';
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
				async (fresh) => fresh
			);
			try {
				await load();
			} catch {
				// the first attempt: the failure the caller sees (once() then calls again)
			}
			const fresh = (await load()) as string;
			if (fresh === retry_url(url, 1)) loaded++;
			// a message that names no URL (Safari) or another origin is not retried under a new one
			if (failed_import_url(new TypeError('Importing a module script failed.')) === null) loaded++;
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
	'page cache: a session of prefetches and visits',
	({ pages }) => {
		const cache = new PageCache({ ttlMs: 60_000, maxEntries: 32, maxBytes: 2_000_000 });
		let hits = 0;
		for (let i = 0; i < 400; i++) {
			const href = pages[(i * 7) % pages.length][0];
			if (cache.get(href) !== null) hits++;
			else cache.set(href, { html: pages[(i * 7) % pages.length][1], url: href });
		}
		return hits;
	},
	{
		setup: () => ({
			pages: Array.from({ length: 64 }, (_, i): [string, string] => [
				`/catalog/${i}`,
				`<main>${JSON.stringify(block(i % 4)).slice(0, 20_000)}</main>`
			])
		})
	}
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
			const refresh = soft.task(async () => 'the page refreshed');
			nav.go('claimed', { href: `/p${i}` });
			const mine = nav.now;
			if (soft.now.kind === 'refreshing') soft.go('idle');
			nav.go('loading', { href: `/p${i}` });
			const page = nav.task(async () => `<h1>p${i}</h1>`);
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
