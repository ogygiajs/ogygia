// The side channels the handle writes into a document (the page seed, the remote seed, the page
// context root, the holes record) are scripts the runtime finds by type. Markup the page carries (a
// CMS block rendered raw, a sanitizer that keeps scripts of a type that does not run) can hold a
// script of the same type, before or after the server's. Islands read the server's channel, never the
// markup's (#893): the one bearing the mark of the document's head runtime script, as the handle
// writes both (INVARIANTS RESPONSE-MARK).
import { afterEach, beforeEach, expect, it } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { page_seed_of, prepare_spa_document, seed_page_once } from '../../src/runtime/seeds.ts';
import { install as install_remote_seeds } from '../../src/runtime/remote-seeds.ts';
import { slots } from '../../src/runtime/slots.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';
import { query_responses } from '../../src/shims/kit-remote/client-stub.ts';
import { collect_provided_context, serialize_provided_context } from '../../src/context-bridge.ts';
import { hole_facts_of } from '../../src/runtime/hole-facts.ts';

link_boot();
install_remote_seeds();

/** The attribute the handle writes the response's mark in (contract/response-mark.ts). */
const MARK_ATTR = 'data-og-mark';
const MARK = '0123456789abcdef01234567';
const placed: Element[] = [];

function script(
	parent: ParentNode,
	attrs: Record<string, string>,
	text: string,
	mark: string | null
): void {
	const doc = parent.ownerDocument ?? (parent as Document);
	const el = doc.createElement('script');
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	if (mark !== null) el.setAttribute(MARK_ATTR, mark);
	el.textContent = text;
	parent.append(el);
	placed.push(el);
}
/** The head runtime script, with `mark` (a type that does not run: a stand-in). */
function runtime_script(doc: Document, mark: string | null): void {
	const el = doc.createElement('script');
	el.setAttribute('data-ogygia-runtime', '');
	if (mark !== null) el.setAttribute(MARK_ATTR, mark);
	el.type = 'application/x-runtime-stand-in';
	doc.head.prepend(el);
	placed.push(el);
}
/** A block of page markup in the body. */
function markup_block(doc: Document = document): HTMLElement {
	const div = doc.createElement('div');
	doc.body.append(div);
	placed.push(div);
	return div;
}
// (plain JSON, the lane a page seed without custom types takes: runtime/wire-format.ts)
const PAGE = { type: 'application/ogygia-page', 'data-og-format': 'json' };
const REMOTE = { type: 'application/ogygia-remote' };
const CTX = { type: 'application/ogygia-ctx', 'data-ogygia-provide-page': '' };
const HOLES = { type: 'application/ogygia-holes', 'data-ogygia-holes': '' };
const page_seed = (who: string) => JSON.stringify({ data: { who } });
const who = () => (page_state.data as { who?: string }).who;

beforeEach(() => {
	prepare_spa_document();
	for (const k in query_responses) delete query_responses[k];
	// (the page context root is cached per page: a swap drops it)
	document.dispatchEvent(new Event('og:after-swap'));
});
afterEach(() => {
	for (const el of placed.splice(0)) el.remove();
});

it("islands read the server's page seed, not one the page markup carries before it", () => {
	runtime_script(document, MARK);
	script(markup_block(), PAGE, page_seed('markup'), null);
	script(document.body, PAGE, page_seed('server'), MARK);

	seed_page_once();

	expect(who()).toBe('server');
});

it("islands read the server's page seed, not one the page markup carries after it (a late hole's)", () => {
	runtime_script(document, MARK);
	script(document.body, PAGE, page_seed('server'), MARK);
	script(markup_block(), PAGE, page_seed('markup'), null);
	script(markup_block(), PAGE, page_seed('other response'), 'fedcba9876543210fedcba98');

	seed_page_once();

	expect(who()).toBe('server');
});

it("islands read the server's remote seed, not one the page markup carries before it", () => {
	runtime_script(document, MARK);
	script(markup_block(), REMOTE, stringify({ q: { 'q/key': 'markup' } }), null);
	script(document.body, REMOTE, stringify({ q: { 'q/key': 'server' } }), MARK);

	slots.remoteSeeds!.seed_once();

	expect(query_responses['q/key']).toBe('server');
});

it("a navigation reads the next document's own page seed, not one its markup carries", () => {
	const doc = document.implementation.createHTMLDocument('next');
	runtime_script(doc, 'aaaaaaaaaaaaaaaaaaaaaaaa');
	script(markup_block(doc), PAGE, page_seed('markup'), null);
	script(doc.body, PAGE, page_seed('next server'), 'aaaaaaaaaaaaaaaaaaaaaaaa');

	expect((page_seed_of(doc)?.data as { who?: string } | undefined)?.who).toBe('next server');
});

it('a document whose head runtime script bears no mark reads no seed', () => {
	runtime_script(document, null);
	script(markup_block(), PAGE, page_seed('markup'), null);

	seed_page_once();

	expect(who()).toBeUndefined();
});

it("islands read the server's page context root, not one the page markup carries before it", () => {
	runtime_script(document, MARK);
	const ctx = (v: string) => serialize_provided_context(new Map([['theme', v]]))!;
	script(markup_block(), CTX, ctx('markup'), null);
	script(document.body, CTX, ctx('server'), MARK);

	expect(collect_provided_context(null)?.get('theme')).toBe('server');
});

it("a hole's facts come from the server's holes record, not one the page markup carries before it", () => {
	runtime_script(document, MARK);
	const record = (endpoint: string) => JSON.stringify({ '/hole.js': { endpoint, sidecar: '' } });
	script(markup_block(), HOLES, record('/markup-endpoint'), null);
	script(document.body, HOLES, record('/server-endpoint'), MARK);

	expect(hole_facts_of(document, '/hole.js')?.endpoint).toBe('/server-endpoint');
});
