import type { RequestEvent } from '@sveltejs/kit';
import { rewrite_pass, type Step } from './pass.ts';
import { restore } from './restore.ts';
import type { CheckOptions, RewriteCheck } from './types.ts';

export function check_event(event?: RequestEvent): RequestEvent {
	if (event) return event;
	const request = new Request('http://localhost/');
	return { request, url: new URL(request.url) } as RequestEvent;
}

function splice(html: string, at: string, add: string): string {
	if (!add) return html;
	const i = html.lastIndexOf(at);
	return i === -1 ? html + add : html.slice(0, i) + add + html.slice(i);
}

function count(html: string, needle: string): number {
	let n = 0;
	for (let at = html.indexOf(needle); at !== -1; at = html.indexOf(needle, at + 1)) n++;
	return n;
}

export async function check(
	steps: readonly Step[],
	html: string,
	options: CheckOptions = {}
): Promise<RewriteCheck> {
	const kind = options.kind ?? 'region';
	const csr = options.csr ?? false;
	const failed: { name: string; error: string }[] = [];
	const pass = rewrite_pass(steps, check_event(options.event), {
		dev: true,
		failed: (f) => failed.push({ name: f.name, error: `${f.code}: ${f.error}` })
	});
	let out: string;
	let head: string[] = [];
	if (kind === 'document') {
		const r = await pass.document(html, {
			csr,
			answer: false,
			// markup-ok: a test's one piece of markup, read once: does it carry the head's end
			head: html.indexOf('</head>') !== -1,
			// markup-ok: and the body's
			body: html.indexOf('</body>') !== -1,
			done: true
		});
		head = r.head ? [r.head] : [];
		out = splice(splice(r.html, '</head>', r.head), '</body>', r.body);
	} else out = await pass.region(html);
	const restored = count(out, ' og-h=');
	if (typeof DOMParser === 'undefined' || typeof window === 'undefined')
		return { html: out, head, restored, failed, dom: null, mismatches: [] };
	const mismatches: string[] = [];
	const heard = (e: Event) => mismatches.push((e as CustomEvent<{ diff: string }>).detail.diff);
	let dom: Document | DocumentFragment;
	if (kind === 'document') {
		// oxlint-disable-next-line ogygia/html-sink -- .check() parses the markup a test hands it, into a document of its own that runs no script and is never inserted
		dom = new DOMParser().parseFromString(out, 'text/html');
		// oxlint-disable-next-line ogygia/owned-effects -- a listener on a document only this call holds: it goes with it
		dom.addEventListener('ogygia:restore-mismatch', heard);
		restore(dom);
	} else {
		const inert = document.implementation.createHTMLDocument('');
		const t = inert.createElement('template');
		// oxlint-disable-next-line ogygia/html-sink -- .check() parses the markup a test hands it, in an inert document, never inserted into the page
		t.innerHTML = out;
		dom = t.content;
		const box = inert.createElement('div');
		// oxlint-disable-next-line ogygia/owned-effects -- a listener on an element only this call holds: it goes with it
		box.addEventListener('ogygia:restore-mismatch', heard);
		box.append(dom);
		restore(box);
		dom.append(...Array.from(box.childNodes));
	}
	return { html: out, head, restored, failed, dom, mismatches };
}
