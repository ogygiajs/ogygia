// The og.$ factory registration script stays one script whatever the factories' code holds (#1345).
import { describe, expect, it } from 'vitest';
import { fn_manifest_script } from '../src/server/fn-manifest-script.ts';

const OPEN = '<script data-ogygia-fnm>';
const CLOSE = '</script>';

/** The script's code, run: the factory map it registers. */
function registered(html: string): Record<string, (...a: unknown[]) => unknown> {
	expect(html.startsWith(OPEN) && html.endsWith(CLOSE)).toBe(true);
	const code = html.slice(OPEN.length, -CLOSE.length);
	const g: { __OG_FNM?: Record<string, (...a: unknown[]) => unknown> } = {};
	// oxlint-disable-next-line typescript/no-implied-eval -- runs the manifest script the server prints
	new Function('globalThis', code)(g);
	return g.__OG_FNM ?? {};
}

describe('fn_manifest_script', () => {
	it('a factory whose code holds </script or <!-- cannot close or escape its tag', () => {
		const html = fn_manifest_script({
			'src/a.ts#f': '() => "</script><b>x</b>"',
			'src/b.ts#g': '() => "<!--<script>"'
		});
		// the only tag closer is the script's own, and no comment opener is left for the tokenizer
		expect(html.toLowerCase().indexOf('</script')).toBe(html.length - CLOSE.length);
		expect(html).not.toContain('<!--');
		const fnm = registered(html);
		expect(fnm['src/a.ts#f']()).toBe('</script><b>x</b>');
		expect(fnm['src/b.ts#g']()).toBe('<!--<script>');
	});

	it('registers each factory under its tag', () => {
		const fnm = registered(fn_manifest_script({ 'src/c.ts#h': '(n) => n + 1' }));
		expect(fnm['src/c.ts#h'](1)).toBe(2);
	});
});
