// scanRegions() finds the regions the browser reads (#1370): a region tag inside a comment, a
// raw-text element's text (a noscript, a textarea, a title too) or an attribute value is not one;
// a quote inside an unquoted value or an attribute name opens nothing; a comment ends where the
// browser ends it; the first of two same-name attributes is the one kept.
import { describe, expect, it } from 'vitest';
import { fuzz, html_arb, markup_tokens_of, start_tags } from '@ogygia/config/html-fuzz';
import { scanRegions, type RegionKind } from '../src/split-regions.ts';

const found = (html: string) => [...scanRegions(html)].map((r) => [r.start, r.kind]);

/** What scanRegions yields, worked out from the browser's own tokens (parse5): a region is a start
 *  tag the browser reads, its kind from the attributes it keeps, balanced by the end tags it reads;
 *  the regions inside an island are not yielded. */
function truth(html: string): [number, RegionKind][] {
	const starts = new Map(
		start_tags(html)
			.filter((t) => t.name === 'ogygia-region')
			.map((t) => [t.start, t])
	);
	const out: [number, RegionKind][] = [];
	const stack: { start: number; kind: RegionKind; emit: boolean; sealed: boolean }[] = [];
	for (const tok of markup_tokens_of(html)) {
		const t = tok.kind === 'start' ? starts.get(tok.start) : undefined;
		if (t) {
			const kind: RegionKind = t.attrs.has('endpoint')
				? 'hole'
				: t.attrs.get('wake') === 'none'
					? 'lake'
					: 'island';
			const sealed_above = stack.at(-1)?.sealed ?? false;
			const node = {
				start: t.start,
				kind,
				emit: !sealed_above,
				sealed: sealed_above || kind === 'island'
			};
			if (html[t.end - 2] === '/') {
				if (node.emit) out.push([node.start, node.kind]);
			} else stack.push(node);
		} else if (
			tok.kind === 'end' &&
			html.slice(tok.start + 2, tok.start + 15).toLowerCase() === 'ogygia-region' &&
			' \t\n\f\r/>'.includes(html[tok.start + 15])
		) {
			const f = stack.pop();
			if (f?.emit) out.push([f.start, f.kind]);
		}
	}
	while (stack.length) {
		const f = stack.pop()!;
		if (f.emit) out.push([f.start, f.kind]);
	}
	return out;
}

const LAKE = '<ogygia-region wake="none"></ogygia-region>';

describe('scanRegions reads the page as the browser does', () => {
	it('a quote inside an unquoted value opens nothing', () => {
		const html = `<p title=it's>x</p>${LAKE}`;
		expect(found(html)).toEqual([[html.indexOf('<ogygia'), 'lake']]);
	});

	it('a comment ends at `--!>` and `<!-->` too', () => {
		for (const c of ['<!-- a --!>', '<!-->', '<!--->']) {
			const html = `${c}${LAKE}<!-- -->`;
			expect(found(html), html).toEqual([[c.length, 'lake']]);
		}
	});

	it('a region tag in a noscript, textarea or title is text', () => {
		for (const raw of ['noscript', 'textarea', 'title'])
			expect(found(`<${raw}>${LAKE}</${raw}>`), raw).toEqual([]);
	});

	it('the first of two same-name attributes decides the kind', () => {
		expect(found('<ogygia-region wake="none" wake="load"></ogygia-region>')).toEqual([[0, 'lake']]);
	});

	it('over generated pages, exactly the regions the browser’s tokens give', () => {
		const PAGE = html_arb({
			tags: ['ogygia-region', 'div', 'p', 'script', 'style', 'noscript', 'textarea', 'template'],
			attrs: ['wake', 'endpoint', 'entry', 'title'],
			values: ['none', 'load'],
			texts: [LAKE, '</ogygia-region>', '<!--<script>']
		});
		fuzz(
			PAGE,
			(html) => {
				expect(found(html), html).toEqual(truth(html));
			},
			{ runs: 500 }
		);
	});
});
