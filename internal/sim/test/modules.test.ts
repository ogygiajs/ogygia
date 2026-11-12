// A simulated tab runs its modules in V8 (src/modules.ts), not in happy-dom's own compiler, which
// leaves `import.meta` raw after `return` or `?` and turns imports into copies. Each case here fails
// on happy-dom's compiler and passes on V8's modules.
import { describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { use_v8_modules } from '../src/modules.ts';
import { modules_in_order } from '../src/happy.ts';

const FILES: Record<string, string> = {
	'/a.js': 'export let n = 0; export function bump() { n++; }',
	'/b.js': "import { n, bump } from './a.js'; bump(); export const seen = n;",
	'/meta.js':
		'function where() { return import.meta.url; }\n' +
		'export const ternary = globalThis.nope ? 0 : import.meta.url;\n' +
		'export const nullish = globalThis.nope ?? import.meta.url;\n' +
		'export const returned = where();',
	'/shared.js': "import './slow.js'; export const shared = 'ran';",
	'/first.js': "import './slow.js'; (globalThis.order ??= []).push('first');",
	'/slow.js': 'export const slow = 1;',
	'/state.js': "import './slow.js'; globalThis.order.push('module ' + document.readyState);"
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
			'<script type="module">' +
				"import { seen } from './b.js'; import * as m from './meta.js';" +
				"document.body.textContent = [seen, m.ternary, m.nullish, m.returned].join(' ');" +
				'</script>';
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
		const page =
			"<script type=\"module\">import './shared.js'; import './gone.js';</script>" +
			'<script type="module">import { shared } from \'./shared.js\'; document.body.textContent = shared;</script>';
		expect(await run(true, page)).toBe('ran');
	});

	// /island-foreign-edit: an inline module ran before the runtime's module above it, so the
	// foreign tool edited the islands before the runtime kept their server markup
	it("the document's module scripts run in its order, an inline one after a slower one above it", async () => {
		modules_in_order();
		const page =
			'<script type="module" src="/first.js"></script>' +
			"<script type=\"module\">(globalThis.order ??= []).push('inline'); document.body.textContent = globalThis.order.join(' ');</script>";
		expect(await run(true, page)).toBe('first inline');
	});

	// (happy-dom reads `interactive` from the start and never fires DOMContentLoaded: a third party's
	// script waiting for it never ran, gen 192's repair mutants all survived, and ogygia's wake gate
	// waited for `load`)
	it('the document is loading while parsed, then fires DOMContentLoaded once its modules ran, then load', async () => {
		modules_in_order();
		const page =
			'<script>globalThis.order = [document.readyState];' +
			"document.addEventListener('DOMContentLoaded', () => order.push('dcl ' + document.readyState));" +
			"addEventListener('load', () => { order.push('load ' + document.readyState); document.body.textContent = order.join(' '); });" +
			'</script>' +
			'<script type="module" src="/state.js"></script>';
		expect(await run(true, page)).toBe('loading module interactive dcl interactive load complete');
	});
});
