// The DOM-free HTML passes of an app's own pass over a rendered document: region scanning and the
// lift / restore round trip, and the reversible-transform marks. Per page, on a CMS document of a few
// hundred regions (core's bench fixture).
import { bench } from '@bench/heisenbench/bench';
import { mark, settle } from '../src/reversible.ts';
import { liftRegions, restoreRegions, scanRegions } from '../src/split-regions.ts';
import { fake_scoped } from '../test/fixtures/fake-scoped-render.ts';
import { document } from '../../core/bench/fixtures.ts';
import { reshape_pass } from '../src/pass.ts';
import type { RequestEvent } from '@sveltejs/kit';

const EVENT = { request: new Request('http://x/'), url: new URL('http://x/') } as RequestEvent;

bench(
	'scanRegions: every region of a document',
	({ html }) => {
		let islands = 0;
		for (const r of scanRegions(html)) if (r.kind === 'island') islands++;
		return islands;
	},
	{
		setup: () => ({ html: document(100) }),
		scale: (_ctx, k) => ({ html: document(100 * k) })
	}
);

bench(
	'liftRegions + restoreRegions: the round trip around a foreign renderer',
	({ html }) => {
		const { shell, regions } = liftRegions(html);
		return restoreRegions(shell, regions).length;
	},
	{
		setup: () => ({ html: document(200) }),
		scale: (_ctx, k) => ({ html: document(200 * k) })
	}
);

bench(
	'reversible mark: plan the hosts of a document',
	({ html }) => mark(html, 'document', false)?.html.length ?? 0,
	{
		setup: () => ({ html: document(200) }),
		scale: (_ctx, k) => ({ html: document(200 * k) })
	}
);

bench(
	'reversible settle: keep what the restorer needs after a scoped render',
	({ rendered, record }) => settle(rendered, record).html.length,
	{ setup: () => scoped(document(200)), scale: (_ctx, k) => scoped(document(200 * k)) }
);

bench(
	'pass: a document through the app’s transform (marked, then settled)',
	async ({ html }) =>
		(await reshape_pass((h) => h, EVENT).document(html, { csr: false, answer: false })).html.length,
	{
		setup: () => ({ html: document(200) }),
		scale: (_ctx, k) => ({ html: document(200 * k) })
	}
);

function scoped(html: string) {
	const marked = mark(html, 'document', false)!;
	return { rendered: fake_scoped(marked.html), record: marked.record };
}
