// A simulated tab runs its modules in V8 (src/modules.ts), not in happy-dom's own compiler, which
// leaves `import.meta` raw after `return` or `?` and turns imports into copies. Each case here fails
// on happy-dom's compiler and passes on V8's modules.
import { describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { use_v8_modules } from '../src/modules.ts';

const FILES: Record<string, string> = {
	'/a.js': 'export let n = 0; export function bump() { n++; }',
	'/b.js': "import { n, bump } from './a.js'; bump(); export const seen = n;",
	'/meta.js': `function where() { return import.meta.url; }
export const ternary = globalThis.nope ? 0 : import.meta.url;
export const nullish = globalThis.nope ?? import.meta.url;
export const returned = where();`,
	'/shared.js': "import './slow.js'; export const shared = 'ran';",
	'/slow.js': 'export const slow = 1;'
};

async function run(v8: boolean, content?: string): Promise<string> {
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
						const W = window as unknown as { Response: typeof Response };
						if (body === undefined) return new W.Response('', { status: 404 }) as never;
						// (late, so a graph that shares it is still linking when its sibling's download fails)
						if (path === '/slow.js') await new Promise((r) => setTimeout(r, 30));
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
			content ??
			`<script type="module">import { seen } from './b.js'; import * as m from './meta.js';document.body.textContent = [seen, m.ternary, m.nullish, m.returned].join(' ');\x3C/script>`;
		await page.waitUntilComplete();
		await new Promise((r) => setTimeout(r, 100));
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

	// seed 368: V8 left the shared module half linked, and the next graph failed with V8's own
	// "can not be resolved on module … that is not linked", an error no browser says
	it('a graph whose download failed leaves its modules usable by the next graph', async () => {
		const page = `<script type="module">import './shared.js'; import './gone.js';\x3C/script><script type="module">import { shared } from './shared.js'; document.body.textContent = shared;\x3C/script>`;
		expect(await run(true, page)).toBe('ran');
	});
});
