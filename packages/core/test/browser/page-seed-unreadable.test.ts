// A page seed the runtime cannot read (runtime/seeds.ts `parse_page_seed`) still leaves the page
// working with no seed, but it is said, with a code (#1480): every island would otherwise hydrate
// with an empty `page.data` while its server HTML shows the real one, and nothing would say why.
import { afterEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { page_seed_of, prepare_spa_document, seed_page_once } from '../../src/runtime/seeds.ts';
import { runtime_session } from '../../src/runtime/session.ts';

link_boot();
afterEach(() => vi.restoreAllMocks());

const MARK = '0123456789abcdef01234567';

/** A fetched document (a navigation's) whose server page seed is `text`. */
function document_with_seed(text: string): Document {
	const doc = document.implementation.createHTMLDocument('');
	const runtime = doc.createElement('script');
	runtime.setAttribute('data-ogygia-runtime', '');
	runtime.setAttribute('data-og-mark', MARK);
	doc.head.append(runtime);
	const seed = doc.createElement('script');
	seed.setAttribute('type', 'application/ogygia-page');
	// (plain JSON, the lane a seed without custom types takes: runtime/wire-format.ts)
	seed.setAttribute('data-og-format', 'json');
	seed.setAttribute('data-og-mark', MARK);
	seed.textContent = text;
	doc.body.append(seed);
	return doc;
}

const said = (warn: { mock: { calls: unknown[][] } }) =>
	warn.mock.calls.map((c) => c.map(String).join(' ')).filter((s) => s.includes('page_seed'));

test('a page seed that reads is no warning', () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const seed = page_seed_of(document_with_seed(JSON.stringify({ data: { title: 'hi' } })));
	expect(seed?.data).toEqual({ title: 'hi' });
	expect(said(warn)).toEqual([]);
});

test('a page seed cut off mid-text is no seed, and is said as page_seed_unreadable', () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const text = JSON.stringify({ data: { title: 'hi' } });
	expect(page_seed_of(document_with_seed(text.slice(0, text.length - 3)))).toBeNull();
	expect(said(warn)).toEqual([expect.stringContaining('ogygiajs.dev/e/page_seed_unreadable')]);
});

test("an answer's page facts that cannot be read are skipped, and said as page_seed_unreadable", () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	prepare_spa_document();
	runtime_session.visit.facts.push(JSON.stringify({ locale: 'fr' }).slice(0, -2));
	seed_page_once();
	expect(said(warn)).toEqual([expect.stringContaining('ogygiajs.dev/e/page_seed_unreadable')]);
});
