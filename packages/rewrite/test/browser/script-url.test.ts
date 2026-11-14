// THE RESTORER REFUSES A SCRIPT URL IN ANY ATTRIBUTE, by core's one check (core/src/script-url.ts),
// both ways it runs: as a module (`restore`) and as the page's inline script (`RESTORER_SCRIPT`,
// which ships the check's source beside its own). The table is core's
// (core/test/_fixtures/script-urls.ts), html.ts runs it too, and each browser's URL parser agrees.
import { afterEach, describe, expect, it } from 'vitest';
import { transformMarkup } from '../../src/reversible.ts';
import { restore } from '../../src/restore.ts';
import { RESTORER_SCRIPT } from '../../src/pass.ts';
import { fake_scoped } from '../fixtures/fake-scoped-render.ts';
import { parser_says_script, SCRIPT_URL_CASES } from '../../../core/test/_fixtures/script-urls.ts';

const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

async function host_with_reset(): Promise<void> {
	const s = await transformMarkup(
		doc(
			'<ogygia-region entry="./a.js" data-og-fp="f1"><demo-card class="own"> hi </demo-card></ogygia-region>'
		),
		fake_scoped,
		{ kind: 'document', dev: true }
	);
	document.body.innerHTML = s.html.slice(
		s.html.indexOf('<body>') + 6,
		s.html.lastIndexOf('</body>')
	);
	const diff: Record<string, string> = {};
	SCRIPT_URL_CASES.forEach((c, i) => (diff[`data-u${i}`] = c.value));
	diff.href = 'data:text/html,x';
	document.querySelector('demo-card')!.setAttribute('og-r', JSON.stringify(diff));
}

function expect_table() {
	const host = document.querySelector('demo-card')!;
	expect(host.shadowRoot).not.toBe(null);
	expect(host.hasAttribute('og-r')).toBe(false);
	SCRIPT_URL_CASES.forEach((c, i) => {
		const name = `data-u${i}`;
		if (c.script) expect(host.hasAttribute(name), c.name).toBe(false);
		else expect(host.getAttribute(name), c.name).toBe(c.value);
	});
	expect(host.hasAttribute('href')).toBe(false);
}

type Globals = { __og_restore?: unknown; __og_restore_adopt?: unknown; __og_sheets?: unknown };

afterEach(() => {
	document.body.innerHTML = '';
	const w = window as Globals;
	w.__og_restore = w.__og_restore_adopt = w.__og_sheets = undefined;
});

describe('the script-URL table in the restorer', () => {
	it('this browser’s URL parser says what the table says', () => {
		for (const c of SCRIPT_URL_CASES) expect(parser_says_script(c.value), c.name).toBe(c.script);
	});

	it('as a module: an attribute reset sets every value but the script URLs', async () => {
		await host_with_reset();
		expect(restore(document)).toBe(1);
		expect_table();
	});

	it('inline, as the page runs it: an attribute reset sets every value but the script URLs', async () => {
		await host_with_reset();
		const open = '<script data-og-restore>';
		const script = document.createElement('script');
		script.textContent = RESTORER_SCRIPT.slice(open.length, -'</script>'.length);
		document.head.append(script);
		script.remove();
		expect_table();
		expect(typeof (window as Globals).__og_restore).toBe('function');
	});
});
