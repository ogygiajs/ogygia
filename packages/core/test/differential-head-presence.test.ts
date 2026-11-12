// DIFFERENTIAL: the handle's head checks (server/head-presence.ts) are regexes and a hand-written
// tag walk over the head slice, run on every response. Each must read the head the way the
// browser does: these generated heads (comments, raw text that looks like tags, `>` inside values,
// any case, entities) are parsed by parse5 and its answer is the truth.
import { expect, it } from 'vitest';
import {
	elements,
	fuzz,
	html_arb,
	parse_document,
	type ParsedElement
} from '@ogygia/config/html-fuzz';
import {
	dedupe_head_links,
	page_declares_dev_hmr_script,
	page_declares_router_meta,
	page_declares_runtime_script,
	page_declares_speculation_rules
} from '../src/server/head-presence.ts';

const HEAD = html_arb({
	// (no <template>: its content is read as tags, which a head never holds a marker in)
	tags: ['meta', 'script', 'link', 'style', 'title', 'noscript', 'textarea', 'div'],
	attrs: [
		'name',
		'content',
		'type',
		'src',
		'rel',
		'href',
		'data-ogygia-runtime',
		'data-ogygia-dev-hmr',
		'data-x'
	],
	values: ['ogygia-router', 'speculationrules', 'stylesheet', 'modulepreload', '/a.css', '/b.js'],
	texts: [
		'<meta name="ogygia-router" content="vt">',
		'<script data-ogygia-runtime src="/r.js"></script>',
		'<script type="speculationrules">{}</script>',
		'<script data-ogygia-dev-hmr>'
	]
});

/** The head slice as the handle sees it, parsed as the browser parses the page it starts. */
const page = (head: string): ParsedElement[] =>
	elements(parse_document(`<!doctype html><html><head>${head}`)).filter(
		(e) => e.ns === 'html' && !e.in_template
	);

it('page_declares_router_meta sees the router meta exactly when the browser has one', () => {
	fuzz(HEAD, (head) => {
		const truth = page(head).some(
			(e) => e.name === 'meta' && e.attrs.get('name') === 'ogygia-router'
		);
		expect(page_declares_router_meta(head), head).toBe(truth);
	});
});

it('page_declares_runtime_script sees the runtime script exactly when the browser has one', () => {
	fuzz(HEAD, (head) => {
		const truth = page(head).some((e) => e.name === 'script' && e.attrs.has('data-ogygia-runtime'));
		expect(page_declares_runtime_script(head), head).toBe(truth);
	});
});

it('page_declares_dev_hmr_script sees the dev script exactly when the browser has one', () => {
	fuzz(HEAD, (head) => {
		const truth = page(head).some((e) => e.name === 'script' && e.attrs.has('data-ogygia-dev-hmr'));
		expect(page_declares_dev_hmr_script(head), head).toBe(truth);
	});
});

it('page_declares_speculation_rules sees speculation rules exactly when the browser has them', () => {
	fuzz(HEAD, (head) => {
		const truth = page(head).some(
			(e) => e.name === 'script' && e.attrs.get('type')?.toLowerCase() === 'speculationrules'
		);
		expect(page_declares_speculation_rules(head), head).toBe(truth);
	});
});

it('dedupe_head_links drops exactly the browser’s repeated stylesheet and modulepreload links', () => {
	fuzz(HEAD, (head) => {
		const links = (h: string) =>
			page(h)
				.filter((e) => e.name === 'link')
				.map((e) => [e.attrs.get('rel'), e.attrs.get('href')] as const);
		const seen = new Set<string>();
		const want = links(head).filter(([rel, href]) => {
			if ((rel !== 'stylesheet' && rel !== 'modulepreload') || href === undefined) return true;
			const key = `${rel} ${href}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		expect(links(dedupe_head_links(head)), head).toEqual(want);
	});
});
