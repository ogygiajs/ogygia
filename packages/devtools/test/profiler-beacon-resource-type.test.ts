import { afterEach, describe, expect, it, vi } from 'vitest';
import { standalone_beacon, type PageBeacon } from '../src/profiler/beacon-standalone.ts';

const KEY = Symbol.for('ogygia.beacon');

afterEach(() => {
	(globalThis as unknown as Record<symbol, PageBeacon | undefined>)[KEY]?.stop();
	vi.unstubAllGlobals();
});

/** each file's type in the page beacon's visit: `[name, initiator, link as]` */
function types_of(files: [string, string, string?][]): string[] {
	const entries = files.map(([name, initiatorType], i) => ({
		name: `https://a.test/${name}?${i}`,
		initiatorType,
		transferSize: 1,
		encodedBodySize: 1,
		decodedBodySize: 1,
		startTime: i,
		responseEnd: i + 1,
		duration: 1
	}));
	const links = files.flatMap(([, , as], i) =>
		as === undefined
			? []
			: [{ href: entries[i].name, getAttribute: (n: string) => (n === 'as' ? as : null) }]
	);
	vi.stubGlobal('document', {
		visibilityState: 'visible',
		readyState: 'complete',
		querySelector: () => null,
		querySelectorAll: (s: string) => (s.startsWith('link') ? links : []),
		addEventListener: () => {}
	});
	vi.stubGlobal('addEventListener', () => {});
	vi.stubGlobal('innerWidth', 1);
	vi.stubGlobal('innerHeight', 1);
	vi.stubGlobal('location', { pathname: '/p', origin: 'https://a.test', href: 'https://a.test/p' });
	vi.stubGlobal('performance', {
		timeOrigin: 0,
		now: () => 0,
		getEntriesByType: (t: string) =>
			t === 'navigation'
				? [{ requestStart: 1, responseStart: 5, responseEnd: 9 }]
				: t === 'resource'
					? entries
					: [],
		getEntriesByName: () => [],
		setResourceTimingBufferSize() {}
	});
	standalone_beacon();
	const api = (globalThis as unknown as Record<symbol, PageBeacon>)[KEY];
	const visit = api.page().visit as { resources: { url: string; type: string }[] };
	return entries.map((e) => visit.resources.find((r) => r.url === e.name)!.type);
}

describe('the page beacon: what a file counts as', () => {
	it('a link is not a stylesheet by itself', () => {
		expect(
			types_of([
				['a.js', 'link', 'script'],
				['b', 'link', 'script'],
				['c', 'link', 'fetch'],
				['d.woff2', 'link', 'font'],
				['e', 'link', 'image'],
				['f', 'link', 'document'],
				['g', 'link'],
				['h.css', 'link', 'style']
			])
		).toEqual(['script', 'script', 'fetch', 'font', 'img', 'other', 'css', 'css']);
	});

	it('the extension first, then what started it', () => {
		expect(
			types_of([
				['a.png', 'css'],
				['b.woff2', 'css'],
				['c', 'css'],
				['d', 'script'],
				['e.css', 'script'],
				['f', 'fetch'],
				['g', 'xmlhttprequest'],
				['h', 'other']
			])
		).toEqual(['img', 'font', 'css', 'script', 'css', 'fetch', 'fetch', 'other']);
	});
});
