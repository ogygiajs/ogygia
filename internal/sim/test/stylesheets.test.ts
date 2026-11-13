// A simulated tab's stylesheets load as a browser's do (src/happy.ts `disabled_stylesheets`).
import { describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { disabled_stylesheets } from '../src/happy.ts';

/** Each download the last `run` made, by path. */
const asked: string[] = [];

async function run(content: string, then?: (doc: Document) => void): Promise<string> {
	disabled_stylesheets();
	asked.length = 0;
	const browser = new Browser({
		settings: {
			enableJavaScriptEvaluation: true,
			suppressInsecureJavaScriptEnvironmentWarning: true,
			enableCSSFileLoading: true,
			fetch: {
				interceptor: {
					beforeAsyncRequest: async ({ request, window }) => {
						asked.push(new URL(request.url).pathname);
						const W = window as unknown as { Response: typeof Response };
						return new W.Response('p { color: red }', {
							headers: { 'content-type': 'text/css' }
						}) as never;
					}
				}
			}
		}
	});
	try {
		const page = browser.newPage();
		page.url = 'https://example.com/';
		page.content = content;
		await page.waitUntilComplete();
		const doc = page.mainFrame.document as unknown as Document;
		if (then !== undefined) {
			then(doc);
			await new Promise((r) => setTimeout(r, 50));
		}
		return doc.body.textContent ?? '';
	} finally {
		await browser.close();
	}
}

describe('stylesheets of a simulated tab', () => {
	// the differential (src/differ.ts): Chromium, Firefox and WebKit never asked for the stylesheets
	// Kit inlines (it lists each as `<link rel="stylesheet" disabled media="(max-width: 0)">`, for
	// its router); the simulator asked for every one, on every page. The HTML spec's fetch setup of
	// a stylesheet link returns early when the element has a `disabled` attribute.
	it('a link with a disabled attribute is not fetched, and fires neither load nor error', async () => {
		const text = await run(
			'<link rel="stylesheet" href="/inlined.css" disabled media="(max-width: 0)"><link rel="stylesheet" href="/on.css"><script>for (const l of document.querySelectorAll("link")) for (const t of ["load", "error"]) l.addEventListener(t, () => (document.body.textContent += l.getAttribute("href") + " " + t + ";"));\x3C/script>'
		);
		expect(asked).toEqual(['/on.css']);
		expect(text).not.toContain('inlined');
	});

	it('one made by script with disabled set is not fetched either', async () => {
		await run('<p>x</p>', (doc) => {
			const l = doc.createElement('link');
			l.rel = 'stylesheet';
			l.href = '/made.css';
			l.setAttribute('disabled', '');
			doc.head.append(l);
		});
		expect(asked).toEqual([]);
	});

	it('removing the disabled attribute fetches it', async () => {
		await run('<link rel="stylesheet" href="/later.css" disabled>', (doc) => {
			doc.querySelector('link')?.removeAttribute('disabled');
		});
		expect(asked).toEqual(['/later.css']);
	});

	// #1702: the router reads `link.disabled` to find Kit's parked sheets and rewrite their relative
	// hrefs before a navigation moves the address (router-nav.ts own_live_head); happy-dom had no
	// such property, so the simulator kept them relative where every browser rewrote them.
	it('a link says it is disabled as the attribute does, and setting it sets the attribute', async () => {
		const seen: unknown[] = [];
		await run(
			'<link rel="stylesheet" href="/parked.css" disabled><link rel="stylesheet" href="/on.css">',
			(doc) => {
				const [parked, on] = doc.querySelectorAll('link');
				seen.push(parked.disabled, on.disabled);
				on.disabled = true;
				parked.disabled = false;
				seen.push(on.hasAttribute('disabled'), parked.hasAttribute('disabled'));
			}
		);
		expect(seen).toEqual([true, false, true, false]);
	});
});
