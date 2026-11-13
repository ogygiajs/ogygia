// The rewrite's server passes over a streamed page (bench/page.ts: about 1 MB in 40 chunks, 300
// matched elements, half restored): the chunk scan for matches, each element's marks, the batch
// splice and settle of a whole response through an identity render, a page with no match (it
// should cost one read and nothing more), and the old whole-document mark and settle for the page
// form. Each scales with the page: steps should grow linearly with it.
import type { RequestEvent } from '@sveltejs/kit';
import { bench } from '@bench/heisenbench/bench';
import { mark, mark_with, settle } from '../src/reversible.ts';
import { matcher, scan, scan_state } from '../src/scan.ts';
import { rewrite_pass, step_of } from '../src/pass.ts';
import type { RewriteElement } from '../src/types.ts';
import { fake_scoped } from '../test/fixtures/fake-scoped-render.ts';
import { streamed, unmatched } from './page.ts';

const EVENT = { request: new Request('http://x/'), url: new URL('http://x/') } as RequestEvent;
const X = matcher('x-');
const identity = (els: readonly RewriteElement[]) => els.map((el) => el.html);
const scoped = (els: readonly RewriteElement[]) =>
	els.map((el) =>
		fake_scoped(el.html.replaceAll('x-card', 'demo-card')).replaceAll('demo-card', 'x-card')
	);

async function respond(chunks: readonly string[], render: typeof identity): Promise<number> {
	const pass = rewrite_pass([step_of({ match: 'x-', render })], EVENT, { dev: false });
	let bytes = 0;
	for (let i = 0; i < chunks.length; i++) {
		const out = await pass.document(chunks[i], {
			csr: false,
			answer: false,
			head: i === 0,
			body: i === chunks.length - 1,
			done: i === chunks.length - 1
		});
		bytes += out.html.length + out.head.length + out.body.length;
	}
	return bytes;
}

function elements(chunks: readonly string[]): string[] {
	const state = scan_state(false);
	const out: string[] = [];
	for (const c of chunks)
		for (const s of scan(c, X, state, false).spans) out.push(c.slice(s.start, s.end));
	return out;
}

bench(
	'rewrite scan: the outermost matches of every chunk of a streamed page',
	({ chunks }) => {
		const state = scan_state(false);
		let n = 0;
		for (const c of chunks) n += scan(c, X, state, false).spans.length;
		return n;
	},
	{ setup: () => ({ chunks: streamed() }), scale: (_ctx, k) => ({ chunks: streamed(k) }) }
);

bench(
	'rewrite: a page with no match goes out as it came',
	async ({ chunks }) => respond(chunks, identity),
	{ setup: () => ({ chunks: [unmatched()] }), scale: (_ctx, k) => ({ chunks: [unmatched(k)] }) }
);

bench(
	'rewrite mark: each matched element marked on its own',
	({ els }) => {
		let n = 0;
		for (let i = 0; i < els.length; i++)
			n +=
				mark_with(els[i], { doc: false, csr: false, all: false, owned: i % 2 === 0 })?.html
					.length ?? 0;
		return n;
	},
	{
		setup: () => ({ els: elements(streamed()) }),
		scale: (_ctx, k) => ({ els: elements(streamed(k)) })
	}
);

bench(
	'rewrite settle: each element after a scoped render',
	({ rendered }) => {
		let n = 0;
		for (const r of rendered) n += settle(r.html, r.record).html.length;
		return n;
	},
	{
		setup: () => ({ rendered: settled_inputs(1) }),
		scale: (_ctx, k) => ({ rendered: settled_inputs(k) })
	}
);

bench(
	'rewrite: a whole streamed response through an identity render (scan, mark, batch, splice, settle)',
	async ({ chunks }) => respond(chunks, identity),
	{ setup: () => ({ chunks: streamed() }), scale: (_ctx, k) => ({ chunks: streamed(k) }) }
);

bench(
	'rewrite: the same response at twice the size (linear: about twice the steps)',
	async ({ chunks }) => respond(chunks, identity),
	{ setup: () => ({ chunks: streamed(2) }) }
);

bench(
	'rewrite: a whole streamed response through a scoped render',
	async ({ chunks }) => respond(chunks, scoped),
	{ setup: () => ({ chunks: streamed() }), scale: (_ctx, k) => ({ chunks: streamed(k) }) }
);

bench(
	'rewrite: matches only in the last chunk (the chunks before it are read once, at that match)',
	async ({ chunks }) => respond(chunks, identity),
	{ setup: () => ({ chunks: last_only() }) }
);

bench(
	'rewrite: two rewrites in sequence, the second rendering inside the first one’s elements',
	async ({ chunks }) => {
		const pass = rewrite_pass(
			[
				step_of({ match: ['x-card'], render: identity }),
				step_of({
					match: ['x-icon'],
					render: (els) => els.map((el) => el.html.replace('></x-icon>', '><b>*</b></x-icon>'))
				})
			],
			EVENT,
			{ dev: false }
		);
		let n = 0;
		for (let i = 0; i < chunks.length; i++)
			n += (
				await pass.document(chunks[i], {
					csr: false,
					answer: false,
					head: i === 0,
					body: false,
					done: false
				})
			).html.length;
		return n;
	},
	{ setup: () => ({ chunks: streamed() }) }
);

bench(
	'rewrite: a batch that throws, retried one element at a time (one in ten still fails)',
	async ({ chunks }) => {
		const failed: unknown[] = [];
		const pass = rewrite_pass(
			[
				step_of({
					match: 'x-',
					render(els) {
						if (els.length > 1) throw new Error('the batch failed');
						if (els[0].html.includes('Card 1')) return [{ html: '<x-card>', sheets: [] }];
						return scoped_sheets(els);
					}
				})
			],
			EVENT,
			{ dev: false, failed: (f) => failed.push(f) }
		);
		for (let i = 0; i < chunks.length; i++)
			await pass.document(chunks[i], {
				csr: false,
				answer: false,
				head: i === 0,
				body: false,
				done: false
			});
		return failed.length;
	},
	{ setup: () => ({ chunks: streamed() }) }
);

bench(
	'rewrite: a region answer of 30 elements, rewritten whole',
	async ({ answer }) =>
		(
			await rewrite_pass([step_of({ match: 'x-', render: scoped_sheets })], EVENT, {
				dev: false
			}).region(answer)
		).length,
	{ setup: () => ({ answer: streamed(1)[1] }) }
);

bench(
	'rewrite page form: a document through rewrite({ page }), held to its last chunk',
	async ({ chunks }) => {
		const pass = rewrite_pass([step_of({ page: (html: string) => html })], EVENT, { dev: false });
		let n = 0;
		for (let i = 0; i < chunks.length; i++)
			n += (
				await pass.document(chunks[i], {
					csr: false,
					answer: false,
					head: i === 0,
					body: i === chunks.length - 1,
					done: i === chunks.length - 1
				})
			).html.length;
		return n;
	},
	{ setup: () => ({ chunks: streamed() }) }
);

bench(
	'rewrite page form: the whole document marked, then settled',
	({ html }) => {
		const m = mark(html, 'document', false)!;
		return settle(m.html, m.record).html.length;
	},
	{
		setup: () => ({ html: streamed().join('') }),
		scale: (_ctx, k) => ({ html: streamed(k).join('') })
	}
);

function scoped_sheets(els: readonly RewriteElement[]) {
	return scoped(els).map((html) => ({
		html,
		sheets: [{ key: 'x-card.shadow', css: 'b{color:red}', scope: 'shadow' as const }]
	}));
}

function last_only(): string[] {
	const chunks = streamed();
	return chunks.map((c, i) =>
		i === chunks.length - 1 ? c : c.replaceAll('x-card', 'y-card').replaceAll('x-icon', 'y-icon')
	);
}

function settled_inputs(k: number) {
	return elements(streamed(k)).map((el, i) => {
		const m = mark_with(el, { doc: false, csr: false, all: false, owned: i % 2 === 0 })!;
		return {
			html: scoped([{ name: 'x-card', html: m.html, restored: true }])[0],
			record: m.record
		};
	});
}
