// A simulated tab runs its modules in V8 (src/modules.ts), not in happy-dom's own compiler, which
// leaves `import.meta` raw after `return` or `?` and turns imports into copies. Each case here fails
// on happy-dom's compiler and passes on V8's modules.
import { describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { use_v8_modules } from '../src/modules.ts';

const FILES: Record<string, string> = {
	'/a.js': 'export let n = 0; export function bump() { n++; }',
	'/b.js': "import { n, bump } from './a.js'; bump(); export const seen = n;",
	'/meta.js':
		'function where() { return import.meta.url; }\n' +
		'export const ternary = globalThis.nope ? 0 : import.meta.url;\n' +
		'export const nullish = globalThis.nope ?? import.meta.url;\n' +
		'export const returned = where();'
};

async function run(v8: boolean): Promise<string> {
	if (v8) use_v8_modules();
	const browser = new Browser({
		settings: {
			enableJavaScriptEvaluation: true,
			suppressInsecureJavaScriptEnvironmentWarning: true,
			fetch: {
				interceptor: {
					beforeAsyncRequest: async ({ request, window }) => {
						const path = new URL(request.url).pathname;
						const body = FILES[path];
						if (body === undefined) return;
						const W = window as unknown as { Response: typeof Response };
						return new W.Response(body, {
							headers: { 'content-type': 'text/javascript' }
						}) as never;
					}
				}
			}
		}
	});
	try {
		const page = browser.newPage();
		page.url = 'https://example.com/';
		page.content =
			'<script type="module">' +
			"import { seen } from './b.js'; import * as m from './meta.js';" +
			"document.body.textContent = [seen, m.ternary, m.nullish, m.returned].join(' ');" +
			'</script>';
		await page.waitUntilComplete();
		return page.mainFrame.document.body.textContent ?? '';
	} finally {
		await browser.close();
	}
}

describe('modules of a simulated tab', () => {
	it('live bindings, and import.meta after return, ? and ??', async () => {
		const url = 'https://example.com/meta.js';
		expect(await run(true)).toBe(`1 ${url} ${url} ${url}`);
	});
});
