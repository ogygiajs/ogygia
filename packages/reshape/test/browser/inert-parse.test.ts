// A PARSED ANSWER IS INERT IN EVERY ENGINE (#382). Region and hole answers become DOM in one place
// (core's runtime/html-sink.ts) and are restored before they go in (src/restore.ts). Nothing in them
// may be built by a component's constructor before that: a host upgraded first already has the root
// its constructor made, and the restore came too late.
//
// Firefox 159 (scoped custom element registries) builds custom elements while a page-owned
// `<template>` parses with `setHTMLUnsafe`; Chromium and WebKit do not. Two tests:
// - the engine as it is (in real Firefox 159 it failed on the old parse);
// - the Firefox 159 model, in every engine: `setHTMLUnsafe` patched, in this test only, to build
//   every defined custom element of the content when the template's document has a window.
import { afterEach, expect, test, vi } from 'vitest';
import { transformMarkup } from '../../src/reversible.ts';
import {
	parse_region_html as parse,
	vouch_page_html
} from '../../../core/src/runtime/html-sink.ts';
import { restore, restore_adopt } from '../../src/restore.ts';
import { report_restores } from '../../src/restore-report.ts';
import { install_rules, runtime_rules } from '../../../core/src/runtime/rules.ts';
import { fake_scoped } from '../fixtures/fake-scoped-render.ts';

// (a test's markup stands in for the page's own, so it goes through the sink like an answer would)
const parse_region_html = (html: string): DocumentFragment => parse(vouch_page_html(html));

const SHEET = '<template data-og-head="demo-card.shadow">b{color:rgb(255, 0, 0)}</template>';

/** How many times a component's constructor ran, by tag. */
const built = new Map<string, number>();

/** A component in the shape the field uses: its constructor makes its root and renders into it,
 *  unless a root is already there (a declarative one, a restored one). */
function define(tag: string): void {
	if (customElements.get(tag)) return;
	customElements.define(
		tag,
		class extends HTMLElement {
			constructor() {
				super();
				built.set(tag, (built.get(tag) ?? 0) + 1);
				if (this.shadowRoot) return;
				const root = this.attachShadow({ mode: 'open' });
				root.innerHTML = '<b>Card title</b><slot></slot>';
			}
		}
	);
}

/** Patches `setHTMLUnsafe` the way Firefox 159 behaves: after the real parse, every defined custom
 *  element of the content is built (its constructor runs, unconnected), when the template's document
 *  has a window (the context element's registry). Returns the undo. */
function firefox_159_model(): () => void {
	const proto = HTMLTemplateElement.prototype as HTMLTemplateElement & {
		setHTMLUnsafe(html: string): void;
	};
	const real = proto.setHTMLUnsafe;
	proto.setHTMLUnsafe = function (this: HTMLTemplateElement, html: string) {
		real.call(this, html);
		const doc = this.ownerDocument;
		if (doc.defaultView === null) return;
		for (const old of Array.from(this.content.querySelectorAll('*'))) {
			if (!customElements.get(old.localName)) continue;
			// built in the template's document: its constructor runs, as in the engine
			const made = doc.createElement(old.localName);
			for (const a of Array.from(old.attributes)) made.setAttribute(a.name, a.value);
			const declared = old.shadowRoot;
			if (declared && made.shadowRoot) {
				// the constructor's root came first: the declarative one stays a plain template
				const t = doc.createElement('template');
				t.setAttribute('shadowrootmode', 'open');
				t.content.append(...Array.from(declared.childNodes));
				made.append(t);
			} else if (declared)
				made.attachShadow({ mode: 'open' }).append(...Array.from(declared.childNodes));
			made.append(...Array.from(old.childNodes));
			old.replaceWith(made);
		}
	};
	return () => {
		proto.setHTMLUnsafe = real;
	};
}

/** A region answer with one planned `demo-card` host, as the server sends it (scoped form). */
async function answer(inner: string): Promise<string> {
	const s = await transformMarkup(
		`<demo-card class="x">${inner}</demo-card>`,
		(h) => SHEET + fake_scoped(h),
		{
			kind: 'region'
		}
	);
	return s.html;
}

afterEach(() => {
	document.body.innerHTML = '';
	for (const t of Array.from(document.head.querySelectorAll('[data-og-head]'))) t.remove();
	const w = window as { __og_sheets?: unknown; __og_restore_log?: unknown };
	w.__og_sheets = undefined;
	w.__og_restore_log = undefined;
	built.clear();
	vi.restoreAllMocks();
});

test('a parsed answer builds none of its custom elements, in this engine (#382)', () => {
	define('demo-count');
	const frag = parse_region_html('<div><demo-count></demo-count><demo-count></demo-count></div>');
	expect(built.get('demo-count') ?? 0).toBe(0);
	for (const el of Array.from(frag.querySelectorAll('demo-count')))
		expect(el).not.toBeInstanceOf(customElements.get('demo-count')!);
	// built once it is in the page, as any element is
	document.body.append(frag);
	expect(built.get('demo-count')).toBe(2);
});

test('under the Firefox 159 model, an answer stays inert, and its host is restored, never late (#382)', async () => {
	define('demo-card');
	const html = await answer(' hi ');
	const undo = firefox_159_model();
	let frag: DocumentFragment;
	try {
		frag = parse_region_html(html);
	} finally {
		undo();
	}
	expect(built.get('demo-card') ?? 0).toBe(0);
	expect(restore(frag)).toBe(1);
	const log = (window as { __og_restore_log?: { kind: string }[] }).__og_restore_log ?? [];
	expect(log.filter((e) => e.kind === 'late')).toEqual([]);
	document.body.append(frag);
	restore_adopt();
	const host = document.querySelector('demo-card')!;
	// the component was built once, in the page, and kept the restored root
	expect(built.get('demo-card')).toBe(1);
	expect(host.shadowRoot!.querySelectorAll('b')).toHaveLength(1);
	// Svelte's children in the light DOM, the rendered tree once (in the root), not twice
	expect(host.innerHTML).toBe(' hi ');
	expect(document.body.querySelectorAll('b')).toHaveLength(0);
});

test('every parse is checked: an answer with a built custom element breaks rule_parse_upgraded', () => {
	define('demo-count');
	install_rules(false);
	const undo = firefox_159_model();
	try {
		// (the model only builds in a template whose document has a window: a page-owned one)
		const t = document.createElement('template');
		t.setHTMLUnsafe('<demo-count></demo-count>');
		// (once by the model, and in Firefox 159 once more by the engine itself)
		expect(built.get('demo-count')).toBeGreaterThan(0);
		const f = parse_region_html('<demo-count></demo-count>');
		expect(f.firstElementChild!.localName).toBe('demo-count');
	} finally {
		undo();
	}
	// the parse above is inert: nothing broken by it
	expect(runtime_rules.broken().map((r) => r.code)).not.toContain('rule_parse_upgraded');
	// a parse that did build one is named
	const upgraded = document.createElement('demo-count');
	const bad = document.createDocumentFragment();
	bad.append(upgraded);
	(globalThis as { __og_parsed?: (f: DocumentFragment) => void }).__og_parsed?.(bad);
	expect(runtime_rules.broken().map((r) => r.code)).toContain('rule_parse_upgraded');
});

test('a shadow sheet a host names but the page lacks is said once per key, with its code', async () => {
	const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const w = window as { __og_restore_log?: { kind: string; host: string; key?: string }[] };
	w.__og_restore_log = [
		{ kind: 'sheet', host: 'demo-card', key: 'demo-missing.shadow' },
		{ kind: 'sheet', host: 'demo-link', key: 'demo-missing.shadow' },
		{ kind: 'sheet', host: 'demo-card', key: 'demo-other.shadow' }
	];
	report_restores();
	await vi.waitFor(() => expect(said).toHaveBeenCalled());
	const lines = said.mock.calls.map((c) => String(c[0]));
	expect(lines.filter((l) => l.includes('restore_sheet_missing'))).toHaveLength(2);
	expect(lines.some((l) => l.includes('demo-missing.shadow'))).toBe(true);
	expect(lines.some((l) => l.includes('demo-other.shadow'))).toBe(true);
	said.mockRestore();
});

test('production: a late restore is said once per page and host tag, with its code', async () => {
	const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const w = window as { __og_restore_log?: { kind: string; host: string }[] };
	w.__og_restore_log = [
		{ kind: 'late', host: 'demo-card' },
		{ kind: 'late', host: 'demo-card' },
		{ kind: 'late', host: 'demo-link' }
	];
	report_restores();
	// (the wording loads when there is something to say, off the boot)
	await vi.waitFor(() => expect(said).toHaveBeenCalled());
	const lines = said.mock.calls.map((c) => String(c[0]));
	expect(lines.filter((l) => l.includes('restore_late'))).toHaveLength(2);
	expect(lines.some((l) => l.includes('demo-card'))).toBe(true);
	expect(lines.some((l) => l.includes('demo-link'))).toBe(true);
});
