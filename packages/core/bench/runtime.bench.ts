// The runtime's DOM-free work, run in Node: the fingerprint and signature hashes, the JSON lane of
// a props sidecar, the page cache, and the keyed body morph of a navigation against the unit
// tests' DOM shim (packages/core/test/_stubs/dom.ts; the shim's own work counts too).
//
// Browser-only runtime code (the custom element, hydration, the router's navigation, the frame and
// lake stores, interaction replay) needs a real document and waits for Heisenbench's browser coverage.
import { el, frag } from '../test/_stubs/dom.ts';
import { bench } from '@bench/heisenbench/bench';
import { fingerprint_of, fnv1a, signature_of } from '../src/runtime/hash.ts';
import { morph_children } from '../src/runtime/morph.ts';
import { PageCache } from '../src/runtime/page-cache.ts';
import { parse_wire_text } from '../src/runtime/wire-format.ts';
import { block, header } from './fixtures.ts';

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
			else cache.set(href, pages[(i * 7) % pages.length][1]);
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
