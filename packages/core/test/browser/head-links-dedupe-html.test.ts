// `dedupe_head_links` reads a `<link>` the way the browser's HTML parser does (#570): the browser
// is the reference. Over seeded random heads, the page the deduped head parses to is the page the
// original parses to with each repeated sheet or hint removed, and nothing else changed.
import { expect, test } from 'vitest';
import { dedupe_head_links } from '../../src/server/head-presence.ts';

const parse = (head: string) =>
	new DOMParser().parseFromString(
		`<!doctype html><html><head>${head}</head><body></body></html>`,
		'text/html'
	);

function rng(seed: number) {
	let s = seed;
	return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

// (each tag mostly carries a rel-like and an href-like attribute, so repeats are common)
const RELS = {
	names: ['rel', 'rel', 'REL', 'Rel', 'data-rel', 'xrel'],
	values: ['stylesheet', 'stylesheet', 'modulepreload', 'icon', '']
};
const HREFS = {
	names: ['href', 'href', 'HREF', 'data-href'],
	values: ['/a.css', "/a'1.css", "/a'2.css", '/a"1.css', '/a>b.css', '/b.js', '']
};
const OTHERS = { names: ['fetchpriority', 'crossorigin', 'as'], values: ['low', '', "'", '"'] };
const TAGS = ['<link', '<link', '<link', '<LINK', '<Link', '<link-x', '<meta'];
const GAPS = [' ', ' ', '\t', '\n', ' / ', '/'];

function attribute(
	pick: <T>(xs: T[]) => T,
	kind: { names: string[]; values: string[] }
): { text: string; quoted: boolean } {
	const name = pick(kind.names);
	const value = pick(kind.values);
	const forms: Array<{ text: string; quoted: boolean }> = [];
	if (!value.includes('"')) forms.push({ text: `${name}="${value}"`, quoted: true });
	if (!value.includes("'")) forms.push({ text: `${name}='${value}'`, quoted: true });
	if (value !== '' && !/["'>]/.test(value)) forms.push({ text: `${name}=${value}`, quoted: false });
	forms.push({ text: name, quoted: false });
	return pick(forms);
}

function head(rnd: () => number): string {
	const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
	let out = '';
	const tags = 1 + Math.floor(rnd() * 8);
	for (let t = 0; t < tags; t++) {
		let tag = pick(TAGS);
		const kinds = [RELS, HREFS, RELS, HREFS, OTHERS].filter(() => rnd() < 0.6);
		for (let k = kinds.length - 1; k > 0; k--) {
			const j = Math.floor(rnd() * (k + 1));
			[kinds[k], kinds[j]] = [kinds[j], kinds[k]];
		}
		let after_quote = false;
		for (const kind of kinds) {
			const { text, quoted } = attribute(pick, kind);
			// (straight after a quoted value, no gap: the parser starts the next attribute there)
			tag += after_quote && rnd() < 0.3 ? text : pick(GAPS) + text;
			after_quote = quoted;
		}
		out += tag + (rnd() < 0.2 ? ' />' : '>');
	}
	return out;
}

/** The parsed document with each repeated `rel="stylesheet"` / `rel="modulepreload"` link (same
 *  family, same href) removed: what the deduped head must parse to. */
function expected(html: string): string {
	const doc = parse(html);
	const seen = { stylesheet: new Set<string>(), modulepreload: new Set<string>() };
	for (const link of doc.querySelectorAll('link')) {
		const rel = link.getAttribute('rel');
		const href = link.getAttribute('href');
		if ((rel !== 'stylesheet' && rel !== 'modulepreload') || href === null) continue;
		if (seen[rel].has(href)) link.remove();
		else seen[rel].add(href);
	}
	return doc.documentElement.outerHTML;
}

test('the deduped head parses to the original page minus its repeated sheets and hints', () => {
	const rnd = rng(570);
	let dropped = 0;
	for (let i = 0; i < 4000; i++) {
		const html = head(rnd);
		const want = expected(html);
		if (want !== parse(html).documentElement.outerHTML) dropped++;
		expect(parse(dedupe_head_links(html)).documentElement.outerHTML, html).toBe(want);
	}
	// (not a vacuous pass: about one head in forty drops a link)
	expect(dropped).toBeGreaterThan(50);
});
