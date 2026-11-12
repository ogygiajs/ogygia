// The waste oracle (src/waste.ts): it finds an answer asked for twice, a thing a document holds
// twice and a warning, and lets a page that does its work once pass.
import { describe, expect, it } from 'vitest';
import { asked_twice, held_twice, warned } from '../src/waste.ts';
import type { World } from '../src/world.ts';

const world = (urls: Array<[string, number | 'dropped']>) =>
	({
		network: {
			exchanges: urls.map(([url, status], i) => ({
				id: i + 1,
				from: 'tab-1#1',
				method: 'GET',
				url: `https://app.test${url}`,
				at: i,
				status,
				cut: false,
				tampered: false,
				duplicated: false,
				redirected: false
			}))
		}
	}) as unknown as World;

describe('asked twice', () => {
	it("finds a hole's answer asked for twice, less its expiry and signature", () => {
		const w = world([
			['/__ogygia__?id=a&props=x&exp=1&sig=s', 200],
			['/__ogygia__?id=a&props=x&exp=2&sig=t', 200]
		]);
		expect(asked_twice(w, 'tab-1#1')).toEqual(['/__ogygia__?id=a&props=x ×2']);
	});

	it('passes a retry after a failure, files, pages and two different answers', () => {
		const w = world([
			['/__ogygia__?id=a&props=x&exp=1&sig=s', 'dropped'],
			['/__ogygia__?id=a&props=x&exp=1&sig=s', 200],
			['/__ogygia__?id=b&props=x&exp=1&sig=s', 200],
			['/_app/immutable/chunks/a.js', 200],
			['/_app/immutable/chunks/a.js', 200],
			['/p1', 200],
			['/p1', 200]
		]);
		expect(asked_twice(w, 'tab-1#1')).toEqual([]);
	});
});

describe('held twice', () => {
	it('finds a stylesheet, a style, props and a preload twice, and passes each once', async () => {
		const { Window } = await import('happy-dom');
		const doc = (body: string) => {
			const w = new Window({ url: 'https://app.test/' });
			w.document.write(`<html><head></head><body>${body}</body></html>`);
			return w.document as unknown as Document;
		};
		const once =
			'<link rel="stylesheet" href="/a.css"><style>p{}</style><script type="application/json" data-ogygia-props="f1">{}</script><link rel="modulepreload" href="/m.js">';
		expect(held_twice(doc(once))).toEqual([]);
		expect(held_twice(doc(once + once))).toEqual([
			'stylesheet https://app.test/a.css',
			'style p{}',
			'props f1:{}',
			'module preload https://app.test/m.js'
		]);
	});
});

describe('warned', () => {
	it("is what the document itself warned, not an earlier document's", () => {
		const tab = {
			realm: 'tab-1#2',
			console: ['warn: old', 'warn: new', 'log: fine'],
			said_by: new Map([
				['warn: old', 'tab-1#1'],
				['warn: new', 'tab-1#2']
			])
		} as unknown as Parameters<typeof warned>[0];
		expect(warned(tab)).toEqual(['warn: new']);
	});
});
