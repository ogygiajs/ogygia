/**
 * What `server/head-presence.ts` states, against the source: each presence check needs a literal
 * `<meta` / `<script` (an escaped `&lt;` copy in prose never matches) in any letter case; the link
 * scan reads only a whole `name="…"` attribute; and `runtime_first` searches for the first script
 * from after `<head>`, not from the start of the slice.
 */
import { describe, expect, it } from 'vitest';
import {
	dedupe_head_links,
	page_declares_dev_hmr_script,
	page_declares_router_meta,
	page_declares_runtime_script,
	page_declares_speculation_rules,
	runtime_first
} from '../src/server/head-presence.ts';

describe('presence checks', () => {
	it('an escaped `&lt;script …` in prose, attribute and all, is not the tag', () => {
		const code = (attrs: string) => `<p><code>&lt;script ${attrs}&gt;</code></p>`;
		expect(page_declares_runtime_script(code('data-ogygia-runtime src="/x.js"'))).toBe(false);
		expect(page_declares_dev_hmr_script(code('data-ogygia-dev-hmr src="/h.js"'))).toBe(false);
		expect(page_declares_speculation_rules(code('type="speculationrules"'))).toBe(false);
		expect(page_declares_router_meta('<code>&lt;meta name="ogygia-router"&gt;</code>')).toBe(false);
	});

	it('a real tag in upper case still counts', () => {
		expect(page_declares_router_meta('<META NAME="ogygia-router" CONTENT="plain">')).toBe(true);
		expect(page_declares_runtime_script('<SCRIPT DATA-OGYGIA-RUNTIME SRC="/x.js"></SCRIPT>')).toBe(
			true
		);
		expect(page_declares_dev_hmr_script('<SCRIPT DATA-OGYGIA-DEV-HMR SRC="/h.js"></SCRIPT>')).toBe(
			true
		);
		expect(page_declares_speculation_rules('<SCRIPT TYPE="SPECULATIONRULES">{}</SCRIPT>')).toBe(
			true
		);
	});
});

describe('the link scan', () => {
	// (a `-` is not a word character, so `data-rel=` reads as `rel=`, as the regex `\brel=` did: #570)
	it('reads `rel` only after a non-word character (`xrel` is another attribute)', () => {
		const link = '<link xrel="stylesheet" href="/a.css">';
		expect(dedupe_head_links(link + link)).toBe(link + link);
	});

	it('reads an attribute only as `name=` and a quote (`rel "stylesheet"` is not one)', () => {
		const link = '<link rel "stylesheet" href="/a.css">';
		expect(dedupe_head_links(link + link)).toBe(link + link);
	});
});

describe('runtime_first', () => {
	it('searches for the first script from after `<head>`, not from the start of the slice', () => {
		const tag = '<script data-ogygia-runtime></script>';
		const head =
			'<script>pre</script><head><meta charset="utf-8"><script src="/a.js"></script></head>';
		expect(runtime_first(head, tag)).toBe(
			`<script>pre</script><head><meta charset="utf-8">${tag}<script src="/a.js"></script></head>`
		);
	});
});
