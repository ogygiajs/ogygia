// The restorer in a browser's document (happy-dom stands in: its own DOM work counts too), on the
// streamed page of bench/page.ts rewritten by a scoped render: the first chunk's full restore over
// the whole document, and the page as it streams, each chunk restoring only its own hosts with
// the short call (`lite`). The second should cost about what the first does in total: no chunk
// reads the whole document again.
import type { RequestEvent } from '@sveltejs/kit';
import { Window } from 'happy-dom';
import { bench } from '@bench/heisenbench/bench';
import { restore } from '../src/restore.ts';
import { rewrite_pass, step_of } from '../src/pass.ts';
import type { RewriteElement } from '../src/types.ts';
import { fake_scoped } from '../test/fixtures/fake-scoped-render.ts';
import { streamed } from './page.ts';

const EVENT = { request: new Request('http://x/'), url: new URL('http://x/') } as RequestEvent;
const scoped = (els: readonly RewriteElement[]) =>
	els.map((el) => ({
		html: fake_scoped(el.html.replaceAll('x-card', 'demo-card')).replaceAll('demo-card', 'x-card'),
		sheets: [{ key: 'x-card.shadow', css: 'b{color:red}', scope: 'shadow' as const }]
	}));

async function rendered(): Promise<string[]> {
	const chunks = streamed();
	const pass = rewrite_pass([step_of({ match: 'x-', render: scoped })], EVENT, { dev: false });
	const out: string[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const r = await pass.document(chunks[i], {
			csr: false,
			answer: false,
			head: false,
			body: false,
			done: i === chunks.length - 1
		});
		out.push(r.html.replace(/<script data-og-restore>[^]*?<\/script>/g, ''));
	}
	return out;
}

function browser() {
	const win = new Window({ url: 'http://x/' });
	const g = globalThis as Record<string, unknown>;
	for (const k of ['window', 'document', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'CSS'])
		g[k] = k === 'window' ? win : (win as unknown as Record<string, unknown>)[k];
	return win;
}

bench(
	'restore: the whole streamed page at once (the first chunk’s restorer)',
	({ doc }) => restore(doc),
	{
		setup: async () => {
			const parts = await rendered();
			const win = browser();
			win.document.body.innerHTML = parts.join('');
			return { doc: win.document as unknown as Document };
		}
	}
);

bench(
	'restore: chunk by chunk, each restoring only its own hosts',
	({ doc, frags }) => {
		let n = 0;
		for (const f of frags) {
			doc.body.append(f);
			n += restore(doc, 1);
		}
		return n;
	},
	{
		setup: async () => {
			const parts = await rendered();
			const win = browser();
			const doc = win.document as unknown as Document;
			const frags = parts.map((p) => {
				const t = doc.createElement('template');
				t.innerHTML = p;
				return t.content;
			});
			return { doc, frags };
		}
	}
);
