// A simulated tab runs its modules in V8 (src/modules.ts), not in happy-dom's own compiler, which
// leaves `import.meta` raw after `return` or `?` and turns imports into copies. Each case here fails
// on happy-dom's compiler and passes on V8's modules.
import { describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { use_v8_modules } from '../src/modules.ts';
import { modules_in_order, window_load_events } from '../src/happy.ts';

const FILES: Record<string, string> = {
	'/a.js': 'export let n = 0; export function bump() { n++; }',
	'/b.js': "import { n, bump } from './a.js'; bump(); export const seen = n;",
	'/meta.js': `function where() { return import.meta.url; }
export const ternary = globalThis.nope ? 0 : import.meta.url;
export const nullish = globalThis.nope ?? import.meta.url;
export const returned = where();`,
	'/shared.js': "import './slow.js'; export const shared = 'ran';",
	'/first.js': "import './slow.js'; (globalThis.order ??= []).push('first');",
	'/slow.js': 'export const slow = 1;',
	'/state.js': "import './slow.js'; globalThis.order.push('module ' + document.readyState);",
	'/needs-slow.js': "import { slow } from './slow.js'; document.body.textContent = String(slow);"
};

/** Each download the last `run` made, by path. */
const asked: string[] = [];

async function run(v8: boolean, content?: string): Promise<string> {
	if (v8) use_v8_modules();
	asked.length = 0;
	const browser = new Browser({
		settings: {
			enableJavaScriptEvaluation: true,
			suppressInsecureJavaScriptEnvironmentWarning: true,
			fetch: {
				interceptor: {
					beforeAsyncRequest: async ({ request, window }) => {
						const path = new URL(request.url).pathname;
						asked.push(path);
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

	// /island-foreign-edit: an inline module ran before the runtime's module above it, so the
	// foreign tool edited the islands before the runtime kept their server markup
	it("the document's module scripts run in its order, an inline one after a slower one above it", async () => {
		modules_in_order();
		const page = `<script type="module" src="/first.js">\x3C/script><script type="module">(globalThis.order ??= []).push('inline'); document.body.textContent = globalThis.order.join(' ');\x3C/script>`;
		expect(await run(true, page)).toBe('first inline');
	});

	// (happy-dom reads `interactive` from the start and never fires DOMContentLoaded: a third party's
	// script waiting for it never ran, gen 192's repair mutants all survived, and ogygia's wake gate
	// waited for `load`)
	it('the document is loading while parsed, then fires DOMContentLoaded once its modules ran, then load', async () => {
		modules_in_order();
		const page = `<script>globalThis.order = [document.readyState];document.addEventListener('DOMContentLoaded', () => order.push('dcl ' + document.readyState));addEventListener('load', () => { order.push('load ' + document.readyState); document.body.textContent = order.join(' '); });\x3C/script><script type="module" src="/state.js">\x3C/script>`;
		expect(await run(true, page)).toBe('loading module interactive dcl interactive load complete');
	});

	// the differential (src/differ.ts): Chromium, Firefox and WebKit all heard `load` and then
	// `pageshow` on a window listener that captures; the simulator heard neither (happy-dom fires
	// `load` to the window's bubbling listeners only, and never fires `pageshow`)
	it('load, then pageshow, reach the window capturing and not, their target the document', async () => {
		window_load_events();
		const page = `<script>globalThis.order = [];for (const type of ['load', 'pageshow']) for (const capture of [true, false]) addEventListener(type, (e) => { order.push(type + (capture ? ' capture' : '') + (e.target === document ? ' document' : '')); document.body.textContent = order.join(', '); }, capture);\x3C/script>`;
		expect(await run(true, page)).toBe(
			'load capture document, load document, pageshow capture document, pageshow document'
		);
	});

	// the differential (src/differ.ts): Chromium asked for each of the runtime's chunks once, the
	// simulator twice. The runtime's script comes before its `modulepreload` links, so its imports
	// were asked of the network while the preloads were still on their way: in a browser the
	// preload's fetch is already the module map's entry, and the import waits for it
	it('an import of a module a modulepreload is still downloading waits for it, not a second download', async () => {
		const page = `<script type="module" src="/needs-slow.js">\x3C/script><link rel="modulepreload" href="/slow.js">`;
		expect(await run(true, page)).toBe('1');
		expect(asked.filter((p) => p === '/slow.js')).toEqual(['/slow.js']);
	});

	// the differential (palaestra 4, a client navigation to /nested): the router's modulepreload of
	// an island module the page had imported at its first load was downloaded again; Chromium's
	// module map had it. The other way round from the case above: the import came first
	it('a modulepreload of a module an import already loaded is not downloaded again', async () => {
		const page = `<script type="module">await import('/slow.js'); const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = '/slow.js'; document.head.append(l); setTimeout(() => (document.body.textContent = 'done'), 50);\x3C/script>`;
		expect(await run(true, page)).toBe('done');
		expect(asked.filter((p) => p === '/slow.js')).toEqual(['/slow.js']);
	});

	// palaestra seed 270: a Kit page left just after its start script's body came still ran the
	// script's `.then`, with an empty namespace: "kit.start is not a function", in no page
	it("a left document's import() never settles: its code stops with it", async () => {
		use_v8_modules();
		let leave = (): void => {};
		const browser = new Browser({
			settings: {
				enableJavaScriptEvaluation: true,
				suppressInsecureJavaScriptEnvironmentWarning: true,
				fetch: {
					interceptor: {
						beforeAsyncRequest: async ({ request, window }) => {
							const W = window as unknown as { Response: typeof Response };
							if (new URL(request.url).pathname !== '/start.js')
								return new W.Response('<p>next</p>', {
									headers: { 'content-type': 'text/html' }
								}) as never;
							// (the body has come; the tab moves on before the module runs)
							leave();
							return new W.Response('export function start() {}', {
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
			const first = page.mainFrame.window as unknown as { settled?: string };
			leave = () => void page.goto('https://example.com/next');
			page.content =
				"<script>import('./start.js').then((kit) => { window.settled = typeof kit.start; }, (e) => { window.settled = 'failed: ' + e.message; });</script>";
			await new Promise((r) => setTimeout(r, 200));
			expect(page.mainFrame.document.body.textContent).toBe('next');
			expect(first.settled).toBeUndefined();
		} finally {
			await browser.close();
		}
	});

	// palaestra (guided search): Kit's boot import of its app entry was cut, and ogygia's wait for
	// Kit asked the same file again to learn Kit cannot start; the simulator downloaded it afresh, so
	// the wait never failed and the island stayed waking. A browser keeps a failed module failed.
	it("a classic script's failed import stays failed for the document's modules", async () => {
		use_v8_modules();
		let asked = 0;
		const browser = new Browser({
			settings: {
				enableJavaScriptEvaluation: true,
				suppressInsecureJavaScriptEnvironmentWarning: true,
				fetch: {
					interceptor: {
						beforeAsyncRequest: async ({ request, window }) => {
							const W = window as unknown as { Response: typeof Response };
							if (new URL(request.url).pathname !== '/app.js')
								return new W.Response('', { status: 404 }) as never;
							// (the first download fails; one asked again would come)
							return (
								asked++ === 0
									? new W.Response('', { status: 500 })
									: new W.Response('export const app = 1;', {
											headers: { 'content-type': 'text/javascript' }
										})
							) as never;
						}
					}
				}
			}
		});
		try {
			const page = browser.newPage();
			page.url = 'https://example.com/';
			page.content =
				"<script>import('./app.js').catch(() => { window.boot = 'failed'; });</script>";
			await new Promise((r) => setTimeout(r, 100));
			const w = page.mainFrame.window as unknown as { boot?: string; again?: string };
			expect(w.boot).toBe('failed');
			const script = page.mainFrame.document.createElement('script');
			script.type = 'module';
			script.textContent =
				"import('./app.js').then(() => { window.again = 'came'; }, () => { window.again = 'failed'; });";
			page.mainFrame.document.body.appendChild(script);
			await new Promise((r) => setTimeout(r, 100));
			expect(w.again).toBe('failed');
		} finally {
			await browser.close();
		}
	});
});
