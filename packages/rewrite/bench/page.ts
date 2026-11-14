// A streamed page the rewrite benches run on, sized like a large CMS page: about 1 MB in 40
// chunks, 300 matched custom elements (`x-card`, some holding an `x-icon` that goes with them),
// half of them in islands (restored), the rest in server-owned markup. The filler between them is
// plain markup a page carries: paragraphs, lists, links, an inline script and style.

const FILLER =
	'<section class="block"><h2 class="t">A heading for the block</h2><p class="lede">Some text that a CMS page carries between components, with <a href="/a/b?c=d">a link</a> and <em>emphasis</em>.</p><ul class="list"><li>one</li><li>two</li><li>three</li></ul></section>';
const SCRIPT = '<script>window.__x = [1, 2, 3].map((n) => n < 2);</script>';
const STYLE = '<style>.block{margin:0 auto}.t{font:600 1rem/1.2 system-ui}</style>';

function card(i: number): string {
	const inner = `<h3 class="title">Card ${i}</h3>\n  <p class="body">Some body text for card ${i}.</p> <x-icon name="star"></x-icon> `;
	return `<x-card class="c" data-i="${i}">${inner}</x-card>`;
}

const island = (inner: string, i: number) =>
	`<ogygia-region entry="./_app/c${i % 7}.js" data-og-fp="f${i}">${inner}</ogygia-region>`;

/** The page in `chunks` chunks with `matches` matched elements (scaled together by `k`). */
export function streamed(k = 1): string[] {
	const chunks = 40 * k;
	const matches = 300 * k;
	const per = Math.ceil(matches / chunks);
	const out: string[] = [];
	let n = 0;
	for (let c = 0; c < chunks; c++) {
		const parts: string[] = [];
		if (c === 0)
			parts.push(
				`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page</title>${STYLE}</head><body><header>${FILLER}</header>`
			);
		for (let j = 0; j < per && n < matches; j++, n++) {
			parts.push(FILLER.repeat(12), SCRIPT);
			parts.push(n % 2 === 0 ? island(card(n), n) : `<div class="server">${card(n)}</div>`);
		}
		if (c === chunks - 1) parts.push('<footer>end</footer></body></html>');
		out.push(parts.join(''));
	}
	return out;
}

/** The same page, one chunk, no element any rewrite matches. */
export function unmatched(k = 1): string {
	return streamed(k).join('').replaceAll('x-card', 'y-card').replaceAll('x-icon', 'y-icon');
}
