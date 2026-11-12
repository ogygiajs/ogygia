// read_styles over a page's sheets: which sheets it leaves out (devtools' own), how it names a dev
// server's injected <style>, and which rules it counts as matching nothing. The page is a stand-in
// with the parts of the CSSOM the reader touches: its sheets, their rules, and querySelector.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unscoped_marker } from '@ogygia/core/internal/instruments';
import { matchable, read_styles, scan_unscoped } from '../src/devtools/styles.ts';

afterEach(() => {
	vi.unstubAllGlobals();
});

type FakeRule = { selectorText?: string; cssText: string; cssRules?: FakeRule[] };
const rule = (selectorText: string): FakeRule => ({ selectorText, cssText: `${selectorText}{}` });
const group = (...inner: FakeRule[]): FakeRule => ({ cssText: '@media', cssRules: inner });

function node(attrs: Record<string, string> = {}, text = '') {
	return {
		getAttribute: (n: string) => attrs[n] ?? null,
		hasAttribute: (n: string) => n in attrs,
		textContent: text
	};
}

const sheet = (rules: FakeRule[], o: { href?: string; attrs?: Record<string, string> } = {}) => ({
	href: o.href ?? null,
	ownerNode: node(o.attrs, rules.map((r) => r.cssText).join('')),
	cssRules: rules
});

/** A page holding `present` (selectors that match), where a selector with `:-moz-` cannot be
 *  queried, and an optional devtools panel whose shadow root holds `panel`. */
function page(sheets: unknown[], present: string[], panel?: string[]) {
	const query = (have: string[]) => (sel: string) => {
		if (sel.includes(':-moz-')) throw new SyntaxError(sel);
		return have.includes(sel) ? {} : null;
	};
	const host = panel && { shadowRoot: { querySelector: query(panel) } };
	return {
		styleSheets: sheets,
		querySelector: (sel: string) =>
			sel === '[data-ogygia-devtools-host]' ? (host ?? null) : query(present)(sel)
	} as unknown as Document;
}

describe('read_styles', () => {
	it('reads the rules inside @media, @supports and nested blocks too', () => {
		const r = read_styles(page([sheet([rule('.here'), group(rule('.gone'))])], ['.here']), {
			match: true
		});
		expect(r.rules).toBe(2);
		expect(r.unmatched).toBe(1);
		expect(r.examples).toEqual(['.gone']);
	});

	it('counts a nested rule’s `&` as used: it needs its parent to mean anything', () => {
		const r = read_styles(page([sheet([rule('& .title')])], []), { match: true });
		expect(r.unmatched).toBe(0);
	});

	it('counts a selector this browser cannot query (a vendor pseudo) as used', () => {
		const r = read_styles(page([sheet([rule('input:-moz-focusring')])], []), { match: true });
		expect(r.unmatched).toBe(0);
	});

	it('leaves out devtools’ own sheets a dev server injected, from the package or its workspace source', () => {
		const dev = (id: string) => sheet([rule('.x')], { attrs: { 'data-vite-dev-id': id } });
		const r = read_styles(
			page(
				[
					dev('/app/node_modules/ogygia/devtools/Panel.svelte?svelte&type=style&lang.css'),
					dev('/repo/packages/devtools/src/devtools/Panel.svelte?svelte&type=style&lang.css'),
					dev('/app/src/routes/devtools/Page.svelte?svelte&type=style&lang.css')
				],
				[]
			)
		);
		expect(r.sheets.map((s) => s.label)).toEqual(['Page.svelte']);
	});

	it('names a dev server’s injected <style> by its file, and a plain one inline', () => {
		const r = read_styles(
			page(
				[
					sheet([rule('.a')], {
						attrs: { 'data-vite-dev-id': '/app/src/App.svelte?svelte&type=style' }
					}),
					sheet([rule('.b')])
				],
				[]
			)
		);
		expect(r.sheets.map((s) => s.label).sort()).toEqual(['App.svelte', 'inline <style>']);
	});

	it('takes a pseudo-element off up to the next space or combinator, past a space in its parens', () => {
		expect(matchable('.x::part(a b) .y')).toBe('.x .y');
		expect(matchable('.x::part(a)>.y')).toBe('.x>.y');
	});

	it('takes off a whole state only: `:target` leaves `:target-current` alone', () => {
		expect(matchable('.m:target-current')).toBe('.m:target-current');
	});

	it('leaves out a linked sheet that styles only the devtools panel, keeps one the page uses too', () => {
		const panel_only = sheet([rule('.og-panel')], { href: 'http://x/assets/panel.css' });
		const shared = sheet([rule('.og-panel'), rule('.page')], { href: 'http://x/assets/app.css' });
		const r = read_styles(page([panel_only, shared], ['.page'], ['.og-panel']));
		expect(r.sheets.map((s) => s.label)).toEqual(['app.css']);
	});
});

describe('scan_unscoped', () => {
	const marked = (file: string) => `${unscoped_marker(file, 'Unexpected token')}.row{color:red}`;

	it('reads an inline sheet’s marker from its node, a linked one’s from one same-origin fetch the HTTP cache answers', async () => {
		vi.stubGlobal('location', { href: 'http://x/', origin: 'http://x' });
		const fetches: [string, RequestInit | undefined][] = [];
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			fetches.push([url, init]);
			return new Response(marked('/src/lib/Linked.svelte'));
		});
		const inline = {
			href: null,
			ownerNode: node({}, marked('/src/lib/Inline.svelte')),
			cssRules: []
		};
		const linked = { href: 'http://x/assets/a.css', ownerNode: node(), cssRules: [] };
		const foreign = { href: 'http://cdn.example.com/b.css', ownerNode: node(), cssRules: [] };
		const own = {
			href: null,
			ownerNode: node(
				{ 'data-vite-dev-id': '/repo/packages/devtools/src/devtools/Panel.svelte?svelte' },
				marked('/src/devtools/Panel.svelte')
			),
			cssRules: []
		};
		const found = await scan_unscoped(page([inline, linked, foreign, own], []));
		expect(found.map((u) => [u.file, u.sheet])).toEqual([
			['Inline.svelte', 'inline <style>'],
			['Linked.svelte', 'a.css']
		]);
		expect(fetches.map(([u, init]) => [u, init?.cache])).toEqual([
			['http://x/assets/a.css', 'force-cache']
		]);
	});
});
