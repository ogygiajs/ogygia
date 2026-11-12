// The standalone export inlines a module script, keeping its other attributes and dropping its
// `type` and `src`. Those are read the way a browser reads the tag (#1370): any quoting, a `>` or
// quote in a value, entities, any case, every copy.
import { describe, expect, it } from 'vitest';
import { tags, type FoundTag } from '@ogygia/core/internal/server';
import { build_standalone } from '../src/profiler/standalone.ts';

const RUNTIME = 'export const r=1;';

/** Every URL the export asked for, in order. */
let loaded: string[] = [];

async function inline(script: string): Promise<string> {
	loaded = [];
	return build_standalone(`<html><head>${script}\x3C/script></head><body></body></html>`, {
		page_url: 'http://h/__profiler/report/abc',
		load: async (url) => {
			loaded.push(url);
			return new URL(url).pathname === '/r.js' ? RUNTIME : null;
		}
	});
}

/** The inlined script of `out` (the one the export marked), or undefined. */
function inlined(out: string): FoundTag | undefined {
	for (const t of tags(out, 'script')) if (t.attr('data-standalone') !== undefined) return t;
}

/** The `type`/`src` spellings a browser reads as `type=module` and `src=/r.js?a=1&b=2`. */
const SPELLINGS: [type: string, src: string][] = [
	['type="module"', 'src="/r.js?a=1&amp;b=2"'],
	["type='module'", "src='/r.js?a=1&amp;b=2'"],
	['type=module', 'src=/r.js?a=1&amp;b=2'],
	['TYPE = "module"', 'SRC = "/r.js?a=1&b=2"'],
	['type="mod&#117;le"', 'src="/r.js?a=1&#38;b=2"']
];

/** Attributes kept as written, some holding what a hand parser trips on. */
const KEPT: string[] = [
	'data-ogygia-runtime',
	'data-n="a>b"',
	"data-q='say \"src=x\"'",
	'data-e="&quot;type=x&quot;"'
];

describe('the standalone export reads a module script the way a browser does', () => {
	for (const [type, src] of SPELLINGS)
		for (const order of [0, 1, 2])
			it(`${type} ${src}, kept attributes at ${order}`, async () => {
				const attrs = [...KEPT];
				attrs.splice(order, 0, type);
				attrs.splice(order + 2, 0, src);
				const out = await inline(`<script ${attrs.join(' ')}>`);
				const t = inlined(out)!;
				expect(t, out).toBeDefined();
				expect(t.attr('type')).toBe('module');
				expect(t.attr('data-standalone')).toBe('/r.js');
				// the URL the browser would fetch: entities decoded
				expect(loaded).toEqual(['http://h/r.js?a=1&b=2']);
				// no `src` survives: a module with one loads the file and ignores its inline text
				expect(t.attr('src'), out).toBeUndefined();
				expect(t.attr('data-ogygia-runtime')).toBe('');
				expect(t.attr('data-n')).toBe('a>b');
				expect(t.attr('data-q')).toBe('say "src=x"');
				// (kept as written: the walk reads values raw)
				expect(t.attr('data-e')).toBe('&quot;type=x&quot;');
				expect(out).toContain(`>${RUNTIME}\x3C/script>`);
			});

	it('a repeated src is dropped in every copy, not just the first', async () => {
		const out = await inline('<script type="module" src="/r.js" data-x src="/other.js">');
		const t = inlined(out)!;
		expect(t.attr('src'), out).toBeUndefined();
		expect(t.attr('data-x')).toBe('');
	});
});
