// The DOM-free HTML passes over a rendered document: region scanning and the lift / restore round
// trip, the reversible-transform marks, the head's link dedupe and runtime placement, the final
// assembly, a hole answer's URL rewrite, and the region-CSS scan. Per page or per hole, on a CMS
// document of a few hundred regions.
import { bench } from '@bench/heisenbench/bench';
import { assemble, locate } from '../src/server/document-assembly.ts';
import {
	dedupe_head_links,
	page_declares_dev_hmr_script,
	page_declares_router_meta,
	page_declares_runtime_script,
	page_declares_speculation_rules,
	runtime_first
} from '../src/server/head-presence.ts';
import { with_early_holes_meta_csp } from '../src/server/early-holes-csp.ts';
import { absolutize_hole_html } from '../src/server/hole-urls.ts';
import { region_css_tags } from '../src/server/html-scan.ts';
import { next_tag, read_tag, tags, text_of } from '../src/wire-markup.ts';
import { mark, settle } from '../src/server/reversible.ts';
import { liftRegions, restoreRegions, scanRegions } from '../src/server/split-regions.ts';
import { fake_scoped } from '../test/fixtures/fake-scoped-render.ts';
import { document, head, hole_answer } from './fixtures.ts';

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

function scoped(html: string) {
	const marked = mark(html, 'document', false)!;
	return { rendered: fake_scoped(marked.html), record: marked.record };
}

bench(
	'head: dedupe repeated hints and sheets, then put the runtime first',
	({ h }) => runtime_first(dedupe_head_links(h), null).length,
	{
		setup: () => ({ h: head(40) }),
		scale: (_ctx, k) => ({ h: head(40 * k) })
	}
);

bench(
	'head: the presence checks (router meta, runtime, dev bridge, speculation rules)',
	({ h }) =>
		+page_declares_router_meta(h) +
		+page_declares_runtime_script(h) +
		+page_declares_dev_hmr_script(h) +
		+page_declares_speculation_rules(h),
	{
		setup: () => ({
			h: head(40).replace('<title>', '<meta name="ogygia-router" content="vt"><title>')
		}),
		scale: (_ctx, k) => ({
			h: head(40 * k).replace('<title>', '<meta name="ogygia-router" content="vt"><title>')
		})
	}
);

bench(
	'assemble: inject the head and the tail into a document',
	({ html, h, tail }) => assemble(html, locate(html), h, '<meta name="x">', tail).length,
	{
		setup: () => {
			const html = document(300);
			return { html, h: head(40), tail: '<script type="application/json">{}</script>'.repeat(20) };
		}
	}
);

bench(
	'hole answer: absolutize entry, endpoint and CSS URLs',
	({ html, base }) => absolutize_hole_html(html, base).length,
	{
		setup: () => ({
			html: hole_answer(60),
			base: new URL('https://example.test/shop/__ogygia__/r?id=abc')
		}),
		scale: (ctx, k) => ({ html: hole_answer(60 * k), base: ctx.base })
	}
);

bench('region CSS: the tags a held region carries forward', ({ h }) => region_css_tags(h).length, {
	setup: () => ({ h: head(40) })
});

// (what a held region's own render head holds: its nested regions' sheets, nothing else)
bench('region CSS: the tags of a region render’s head', ({ h }) => region_css_tags(h).length, {
	setup: () => ({ h: region_css_tags(head(8)) })
});

bench(
	'head: the early start’s hash into a policy meta',
	({ h }) => with_early_holes_meta_csp(h).length,
	{
		setup: () => ({
			h: head(40).replace(
				'<title>',
				`<meta http-equiv="content-security-policy" content="script-src 'self' 'nonce-abc'"><title>`
			)
		})
	}
);

bench(
	'tags: every region open tag of a document, attributes read',
	({ html }) => {
		let n = 0;
		for (const t of tags(html, 'ogygia-region')) n += t.attrs.size;
		return n;
	},
	{
		setup: () => ({ html: document(100) }),
		scale: (_ctx, k) => ({ html: document(100 * k) })
	}
);

// (document()'s title check: a head with none is read to its end)
bench('next_tag: a title in a head that has none', ({ h }) => next_tag(h, 'title', 0) === null, {
	setup: () => ({ h: head(40).replace(/<title>.*?<\/title>/, '') })
});

bench('read_tag: one link tag of a head', ({ h, at }) => read_tag(h, at, at + 5)?.attrs.size, {
	setup: () => {
		const h = head(40);
		return { h, at: h.indexOf('<link') };
	}
});

bench(
	'text_of: a script element of a document',
	({ html, tag }) => text_of(html, tag, 'script')?.length,
	{
		setup: () => {
			const html = document(100);
			return { html, tag: tags(html, 'script').next().value! };
		}
	}
);
