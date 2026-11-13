// THE BOOT ORDER ON A KIT PAGE (#1561). On a csr=true page Kit's start (a classic inline script at
// the end of the body that calls `import()` on Kit's entry) could hydrate, and on a mismatch remount
// the page, before the runtime (a deferred module script) booted, and every lake stayed empty. The
// handle makes the entry's `import()` wait for DOMContentLoaded; the rest of Kit's script is as Kit
// wrote it. (An import map pointing the entry at a gate module was tried first: Kit preloads its
// entry in a `Link` header, and Firefox drops an import map once any module load started, while
// Chromium ignores a rule for a URL already preloaded.)
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KIT_START_WAIT, kit_gate } from '../src/server/kit-gate.ts';
import { with_early_holes_csp, with_early_holes_meta_csp } from '../src/server/early-holes-csp.ts';

const START = 'import("./_app/immutable/entry/start.AAA.js")';
const APP = 'import("./_app/immutable/entry/app.BBB.js")';

const kit_text = `
	{
		__sveltekit_x1 = { base: new URL(".", location).pathname.slice(0, -1) };
		const element = document.currentScript.parentElement;
		Promise.all([
			${START},
			${APP}
		]).then(([kit, app]) => { kit.start(app, element, { node_ids: [0, 2] }); });
	}
`;

const page = (nonce = '') =>
	`<!doctype html><html><head><meta charset="utf-8"></head><body><div style="display: contents"><main>hi</main><script${nonce ? ` nonce="${nonce}"` : ''}>${kit_text}</script></div></body></html>`;

const body_end = (html: string) => html.lastIndexOf('</body>');
const script_text = (html: string) => {
	const at = html.lastIndexOf('<script');
	return html.slice(html.indexOf('>', at) + 1, html.lastIndexOf('</script>'));
};

describe('the Kit start gate', () => {
	it('makes the start entry import wait for DOMContentLoaded, and changes nothing else', () => {
		const html = page();
		const gate = kit_gate(html, body_end(html))!;
		expect(gate.html).toBe(html.replace(START, `${KIT_START_WAIT}.then(() => ${START})`));
		expect(gate.html.length - html.length).toBe(gate.delta);
		expect(script_text(gate.html)).toContain('__sveltekit_x1 = {');
		expect(script_text(gate.html)).toContain(APP);
	});

	it('finds Kit script whole however much data it carries (a large page, 200 KB of it)', () => {
		const big = `data: [null,{type:"data",data:{css:"${'x'.repeat(200_000)}"}}],`;
		const html = page().replace('const element', `${big}\n\t\tconst element`);
		const gate = kit_gate(html, body_end(html))!;
		expect(gate).not.toBeNull();
		expect(gate.html).toBe(html.replace(START, `${KIT_START_WAIT}.then(() => ${START})`));
	});

	it('looks no further back than scripts that end in the last 64 KB', () => {
		const html = `${page().replace('</div></body>', '</div>')}<p>${'y'.repeat(70_000)}</p></body></html>`;
		expect(kit_gate(html, body_end(html))).toBeNull();
	});

	it('keeps Kit nonce on the script', () => {
		const html = page('r4nd0m+/=');
		expect(kit_gate(html, body_end(html))!.html).toContain('<script nonce="r4nd0m+/=">');
	});

	it('its hash source is of the new text of the script, for a hash policy', () => {
		const html = page();
		const gate = kit_gate(html, body_end(html))!;
		const digest = createHash('sha256').update(script_text(gate.html), 'utf8').digest('base64');
		expect(gate.source).toBe(`'sha256-${digest}'`);
	});

	it('is nothing without Kit boot, without its import, or when the page is gated already', () => {
		const bare = '<html><head></head><body><main>hi</main></body></html>';
		expect(kit_gate(bare, body_end(bare))).toBeNull();
		const odd = '<html><head></head><body><script>__sveltekit_x = {};</script></body></html>';
		expect(kit_gate(odd, body_end(odd))).toBeNull();
		const html = page();
		const once = kit_gate(html, body_end(html))!.html;
		expect(kit_gate(once, body_end(once))).toBeNull();
	});

	it('the wait settles once the document is parsed, whatever loaded or failed', async () => {
		const listeners: Array<() => void> = [];
		const doc = {
			readyState: 'loading',
			addEventListener: (_: string, r: () => void) => listeners.push(r)
		};
		// oxlint-disable-next-line typescript/no-implied-eval -- runs the wait script the server prints, against a stand-in document
		const wait = new Function('document', `return ${KIT_START_WAIT};`) as (
			d: typeof doc
		) => Promise<void>;
		let settled = false;
		const p = wait(doc).then(() => (settled = true));
		await Promise.resolve();
		expect(settled).toBe(false);
		for (const r of listeners) r();
		await p;
		expect(settled).toBe(true);
		await wait({ ...doc, readyState: 'interactive' });
	});

	it('a hash policy gets the new text hash beside the early start one; unsafe-inline is left', () => {
		const sources = ["'sha256-AAA'", "'sha256-BBB'"];
		expect(with_early_holes_csp("script-src 'self' 'sha256-kit'", sources)).toBe(
			"script-src 'self' 'sha256-kit' 'sha256-AAA' 'sha256-BBB'"
		);
		expect(with_early_holes_csp("script-src 'nonce-n' 'sha256-AAA'", sources)).toBe(
			"script-src 'nonce-n' 'sha256-AAA' 'sha256-BBB'"
		);
		expect(with_early_holes_csp("script-src 'unsafe-inline'", sources)).toBe(
			"script-src 'unsafe-inline'"
		);
		expect(
			with_early_holes_meta_csp(
				`<meta http-equiv="content-security-policy" content="script-src 'self'">`,
				sources
			)
		).toBe(
			`<meta http-equiv="content-security-policy" content="script-src 'self' 'sha256-AAA' 'sha256-BBB'">`
		);
	});
});
