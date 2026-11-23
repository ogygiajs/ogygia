// The page head read once (server/head-presence.ts `HeadTags`, markup-walk.ts `read_head`): over
// generated heads, the one reading gives byte for byte what the separate walks it replaced gave
// (copied below as they were, the oracle): the link dedupe, each presence check, and where the
// runtime goes, on the head the handle found by `head_end`.
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { RESPONSE_MARK } from '../src/contract/response-mark.ts';
import { HeadTags } from '../src/server/head-presence.ts';
import {
	attr_spans,
	head_end,
	Needle,
	next_tag,
	read_head,
	read_tag,
	OG_ORIGINS,
	OGYGIA_DEV_HMR,
	OGYGIA_RUNTIME,
	OGYGIA_RUNTIME_DEP,
	type FoundTag
} from '../src/wire-markup.ts';

// ── the oracle: head-presence.ts before the one reading ──
function old_find_tag(
	html: string,
	name: string,
	needle: string | RegExp,
	test: (tag: FoundTag) => boolean,
	from = 0
): FoundTag | null {
	const held = new Needle(html, needle, from);
	if (held.gone) return null;
	for (let t = next_tag(html, name, from); t !== null; t = next_tag(html, name, t.next)) {
		if (held.holds(t) && test(t)) return t;
		if (held.gone) return null;
	}
	return null;
}

function old_has_tag(
	html: string,
	name: string,
	needle: string | RegExp,
	test: (tag: FoundTag) => boolean
): boolean {
	return old_find_tag(html, name, needle, test) !== null;
}

function old_page_declares_router_meta(html: string): boolean {
	return old_has_tag(html, 'meta', 'ogygia-router', (t) => t.attr('name') === 'ogygia-router');
}

function old_page_declares_runtime_script(html: string): boolean {
	return old_has_tag(html, 'script', RUNTIME_NEEDLE_G, is_runtime);
}

const is_runtime = (t: FoundTag) => t.attr(OGYGIA_RUNTIME) !== undefined;
const is_modulepreload = (t: FoundTag) => MODULEPRELOAD_TOKEN.test(t.attr('rel') ?? '');

function old_page_declares_dev_hmr_script(html: string): boolean {
	return old_has_tag(html, 'script', DEV_HMR_NEEDLE_G, (t) => t.attr(OGYGIA_DEV_HMR) !== undefined);
}

function old_page_declares_speculation_rules(html: string): boolean {
	return old_has_tag(html, 'script', SPECULATION_NEEDLE_G, (t) =>
		SPECULATION_TYPE.test(t.attr('type') ?? '')
	);
}

const RUNTIME_NEEDLE_G = new RegExp(OGYGIA_RUNTIME, 'gi');
const DEV_HMR_NEEDLE_G = new RegExp(OGYGIA_DEV_HMR, 'gi');
const SPECULATION_NEEDLE_G = /speculationrules/gi;
const MODULEPRELOAD_NEEDLE_G = /modulepreload/gi;
const MODULEPRELOAD_TOKEN = /(?:^|[\t\n\f\r ])modulepreload(?:[\t\n\f\r ]|$)/i;
const SPECULATION_TYPE = /^[\t\n\f\r ]*speculationrules[\t\n\f\r ]*$/i;

function old_dedupe_head_links(head: string): string {
	let t = next_tag(head, 'link', 0);
	if (t === null) return head;
	const sheets = new Set<string>();
	const hints = new Set<string>();
	let out: string[] | null = null;
	let kept = 0;
	for (; t !== null; t = next_tag(head, 'link', t.next)) {
		const rel = t.attr('rel');
		let seen = sheets;
		if (rel === 'modulepreload') seen = hints;
		else if (rel !== 'stylesheet') continue;
		const href = t.attr('href');
		if (href === undefined) continue;
		if (!seen.has(href)) {
			seen.add(href);
			continue;
		}
		(out ??= []).push(head.slice(kept, t.start));
		kept = t.end;
	}
	if (out === null) return head;
	out.push(head.slice(kept));
	return out.join('');
}

const HEAD_CLOSE_G = /<\/head\s*>/gi;

function old_runtime_unit(head: string): { start: number; end: number } | null {
	const script = old_find_tag(head, 'script', RUNTIME_NEEDLE_G, is_runtime);
	if (script === null || !head.startsWith('</script>', script.end)) return null;
	let end = script.end + '</script>'.length;
	for (;;) {
		const dep = next_tag(head, 'link', end);
		if (dep === null || dep.start !== end || dep.attr(OGYGIA_RUNTIME_DEP) === undefined) break;
		end = dep.end;
	}
	return { start: script.start, end };
}

function old_runtime_first(
	head: string,
	runtime: string | null,
	code_origins: readonly string[] = [],
	mark = ''
): string {
	const found = old_runtime_unit(head);
	const was = found ? head.slice(found.start, found.end) : runtime;
	if (was === null) return head;
	const placed = old_with_code_origins(was, code_origins);
	const tag = mark ? `<script ${RESPONSE_MARK}="${mark}"${placed.slice(7)}` : placed;
	const rest = found ? head.slice(0, found.start) + head.slice(found.end) : head;
	const from = next_tag(rest, 'head', 0)?.end ?? 0;
	let at = next_tag(rest, 'script', from)?.start ?? Infinity;
	const hint = old_find_tag(rest, 'link', MODULEPRELOAD_NEEDLE_G, is_modulepreload, from);
	if (hint !== null && hint.start < at) at = hint.start;
	if (at === Infinity) {
		HEAD_CLOSE_G.lastIndex = from;
		at = HEAD_CLOSE_G.exec(rest)?.index ?? rest.length;
	}
	if (found && found.start === at && tag === was) return head;
	return rest.slice(0, at) + tag + rest.slice(at);
}

function old_with_code_origins(tag: string, urls: readonly string[]): string {
	const origins = new Set<string>();
	for (const url of urls) {
		try {
			const u = new URL(url);
			if (u.protocol === 'https:' || u.protocol === 'http:') origins.add(u.origin);
			// oxlint-disable-next-line ogygia/no-silent-failures -- not a URL: no origin to allow
		} catch {}
	}
	const bare = old_without_attr(tag, OG_ORIGINS);
	if (!origins.size) return bare;
	const script = read_tag(bare, 0, SCRIPT_OPEN.length);
	const at = script === null ? undefined : attr_spans(bare, script, 'script', OGYGIA_RUNTIME)[0];
	if (at === undefined) return bare;
	return `${bare.slice(0, at[1])} ${OG_ORIGINS}="${[...origins].join(' ')}"${bare.slice(at[1])}`;
}

const SCRIPT_OPEN = '<script';

function old_without_attr(unit: string, attr: string): string {
	const script = read_tag(unit, 0, SCRIPT_OPEN.length);
	if (script === null) return unit;
	let out = '';
	let from = 0;
	for (const [start, end] of attr_spans(unit, script, 'script', attr)) {
		out += unit.slice(from, start);
		from = end;
	}
	return from === 0 ? unit : out + unit.slice(from);
}

// ── generated heads ──
const RUNTIME = '<script data-ogygia-runtime type="module" src="/_app/r.js"></script>';
const PIECE = fc.constantFrom(
	'<head>',
	'<HEAD lang=en>',
	'<meta charset="utf-8">',
	'<meta name="ogygia-router" content="vt">',
	'<META NAME=ogygia-router>',
	'<meta name="ogygia-routerx">',
	'<title>t</title>',
	'<title><script data-ogygia-runtime></title>',
	RUNTIME,
	'<SCRIPT DATA-OGYGIA-RUNTIME src="/r2.js"></SCRIPT>',
	'<script data-ogygia-runtime src="/r3.js">x</script>',
	'<link rel="modulepreload" href="/dep.js" data-ogygia-runtime-dep>',
	'<link rel="modulepreload" href="/a.js">',
	'<link rel="modulepreload" href="/a.js" fetchpriority="low">',
	'<link rel=" modulepreload " href="/b.js">',
	'<link rel="stylesheet" href="/a.css">',
	'<link href="/a.css" rel="stylesheet">',
	'<link rel="preload" href="/f.woff2" as="font">',
	'<link rel="modulepreload">',
	'<script>var x = "<script data-ogygia-runtime>";</script>',
	'<script type="speculationrules">{}</script>',
	'<script type=" SpeculationRules ">{}</script>',
	'<script data-ogygia-dev-hmr src="/h.js"></script>',
	'<script type="module" src="/app.js"></script>',
	'<style>a{}</style>',
	'<!-- <script data-ogygia-runtime> -->',
	'<!---->',
	'<!x <link rel=modulepreload href=/a.js>>',
	'<?pi <script data-ogygia-runtime> ?>',
	'</p>',
	'</>',
	'<code>&lt;meta name="ogygia-router"&gt;</code>',
	'<noscript><link rel="stylesheet" href="/a.css"></noscript>',
	'<div title="a>b" data-x>',
	'<',
	'<<',
	'a',
	'x<',
	'script>',
	' ',
	'\n'
);
/** A head slice as the handle cuts it, and the document it is the front of. */
const HEADS = fc.array(PIECE, { maxLength: 24 }).map((p) => p.join(''));
const ORIGINS = fc.constantFrom([], ['https://peer.example/x.js'], ['not a url', 'http://a.test/']);
const MARK = fc.constantFrom('', 'm1');
const TAG = fc.constantFrom(
	null,
	'<script data-ogygia-runtime type="module" src="/_app/boot.js"></script>'
);

describe('the page head read once gives what the walks it replaced gave', () => {
	it('the head end, the link dedupe, every presence check and the runtime placement', () => {
		fc.assert(
			fc.property(HEADS, TAG, ORIGINS, MARK, (head, tag, origins, mark) => {
				const doc = `${head}</head><body><p>x</p></body>`;
				const end = head_end(doc);
				const read = read_head(doc);
				expect(read.end).toBe(end);
				if (end === -1) return;
				const slice = doc.slice(0, end);
				const probe = old_dedupe_head_links(slice);
				const tags = new HeadTags(slice, read).deduped();
				expect(tags.html).toBe(probe);
				expect(tags.declares_router_meta()).toBe(old_page_declares_router_meta(probe));
				expect(tags.declares_runtime_script()).toBe(old_page_declares_runtime_script(probe));
				expect(tags.declares_dev_hmr_script()).toBe(old_page_declares_dev_hmr_script(probe));
				expect(tags.declares_speculation_rules()).toBe(old_page_declares_speculation_rules(probe));
				expect(tags.runtime_first(tag, origins, mark)).toBe(
					old_runtime_first(probe, tag, origins, mark)
				);
				// (the head as read on its own, with no document around it: the wrappers' path)
				expect(new HeadTags(slice).runtime_first(tag, origins, mark)).toBe(
					old_runtime_first(slice, tag, origins, mark)
				);
			}),
			{ numRuns: 20_000 }
		);
	}, 30_000);

	it('a bare `<` before the moved runtime reads the rest again (it meets the text after it)', () => {
		const head = `<head><title>t</title>x<${RUNTIME}a href=x><script src="/app.js"></script>`;
		const doc = `${head}</head><body></body>`;
		const read = read_head(doc);
		const slice = doc.slice(0, read.end);
		expect(new HeadTags(slice, read).runtime_first(null)).toBe(old_runtime_first(slice, null));
	});
});
