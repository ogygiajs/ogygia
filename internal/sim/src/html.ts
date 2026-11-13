/**
 * HTML QUALITY: what ogygia sends and what it leaves in a page is good HTML. Two views:
 *
 * - every HTML answer a server gave (a page, a hole's answer, a peer's fragment), through a spec
 *   parser (parse5): its parse errors, each placed in the element it falls in;
 * - every document at rest, after whatever navigations and morphs built it (a DOM built by code
 *   never meets the parser, so a `<div>` the morph put inside a `<p>` is only seen here).
 *
 * Both are walked for the content model: no flow element inside a `<p>`, no `<a>` in an `<a>`, no
 * `<form>` in a `<form>`, nothing interactive in a `<button>`, a table's own children only, no id
 * twice, no `<title>`/`<meta>`/`<base>`/`<style>` in the body, no empty `<title>`.
 *
 * What the app wrote is the app's: the random app writes good HTML, and what it writes badly on
 * purpose carries `data-gen-messy` (src/gen.ts). A finding in such an element, or under one, is the
 * app's and is set aside; every other is ogygia's (or the framework's shell, told apart in triage).
 */
import { parse, parseFragment, type DefaultTreeAdapterMap, type ParserError } from 'parse5';
import type { Tab } from './browser.ts';
import type { Broken } from './oracles.ts';
import type { World } from './world.ts';

/** One element, whichever tree it came from. */
interface El {
	readonly tag: string;
	attr(name: string): string | null;
	readonly names: readonly string[];
	readonly kids: readonly El[];
	readonly text: string;
	readonly parent: El | null;
}

/** A finding: the rule, where (a short path to the element), and whether the app wrote it. */
export interface Lint {
	readonly rule: string;
	readonly where: string;
	readonly app: boolean;
}

/** Elements that are flow content only: none may be inside a `<p>`. */
const BLOCK = new Set(
	'address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section table ul'.split(
		' '
	)
);
const INTERACTIVE = new Set('a button input select textarea details embed iframe label'.split(' '));
const TABLE_KIDS: Record<string, Set<string>> = {
	table: new Set('caption colgroup thead tbody tfoot tr script template'.split(' ')),
	thead: new Set(['tr', 'script', 'template']),
	tbody: new Set(['tr', 'script', 'template']),
	tfoot: new Set(['tr', 'script', 'template']),
	tr: new Set(['td', 'th', 'script', 'template'])
};
const HEAD_ONLY = new Set(['title', 'meta', 'base', 'style']);

/** Whether the app wrote `el` badly on purpose (it, or an element around it, says so). */
function messy(el: El | null): boolean {
	for (let e = el; e !== null; e = e.parent) if (e.attr('data-gen-messy') !== null) return true;
	return false;
}

/** A short path to `el`: its tag and its nearest ancestors', each with what tells it apart. */
function path_of(el: El): string {
	const parts: string[] = [];
	for (let e: El | null = el, n = 0; e !== null && n < 4; e = e.parent, n++) {
		const id = e.attr('id');
		const gen = e.attr('data-gen');
		const mark = id ? `#${id}` : gen ? `[data-gen=${gen}]` : '';
		parts.unshift(e.tag + mark);
	}
	return parts.join(' > ');
}

/** The content-model findings in the tree under `root`. */
export function content_model(root: El): Lint[] {
	const out: Lint[] = [];
	const ids = new Map<string, El>();
	const flag = (rule: string, el: El) => out.push({ rule, where: path_of(el), app: messy(el) });
	const walk = (el: El, inside: { p?: El; a?: El; form?: El; button?: El; body: boolean }) => {
		const tag = el.tag;
		if (inside.p && BLOCK.has(tag)) flag(`<${tag}> inside <p>`, el);
		if (inside.a && tag === 'a') flag('<a> inside <a>', el);
		if (inside.form && tag === 'form') flag('<form> inside <form>', el);
		if (inside.button && INTERACTIVE.has(tag)) flag(`<${tag}> inside <button>`, el);
		const parent = el.parent;
		if (parent && TABLE_KIDS[parent.tag] && !TABLE_KIDS[parent.tag].has(tag))
			flag(`<${tag}> inside <${parent.tag}>`, el);
		if (inside.body && HEAD_ONLY.has(tag)) flag(`<${tag}> in the body`, el);
		if (tag === 'title' && el.text.trim() === '') flag('an empty <title>', el);
		const id = el.attr('id');
		if (id !== null) {
			if (ids.has(id)) flag(`id "${id}" twice`, el);
			else ids.set(id, el);
		}
		const next = {
			// (a `<p>` ends what came before it: a block in it is judged against the nearest one)
			p: tag === 'p' ? el : BLOCK.has(tag) ? undefined : inside.p,
			a: tag === 'a' ? el : inside.a,
			form: tag === 'form' ? el : inside.form,
			button: tag === 'button' ? el : inside.button,
			body: inside.body || tag === 'body'
		};
		for (const k of el.kids) walk(k, next);
	};
	walk(root, { body: false });
	return out;
}

type P5Node = DefaultTreeAdapterMap['node'];
type P5Element = DefaultTreeAdapterMap['element'];

/** parse5's tree as {@link El}s, with each element's source span. */
function from_parse5(
	node: P5Node,
	parent: El | null,
	spans: Array<{ el: El; from: number; to: number }>
): El[] {
	if (!('tagName' in node)) {
		const kids = 'childNodes' in node ? node.childNodes : [];
		return kids.flatMap((k) => from_parse5(k, parent, spans));
	}
	const e = node as P5Element;
	const attrs = new Map(e.attrs.map((a) => [a.name, a.value]));
	const kids: El[] = [];
	const el: El = {
		tag: e.tagName,
		attr: (n) => attrs.get(n) ?? null,
		names: [...attrs.keys()],
		kids,
		text: e.childNodes.map((c) => ('value' in c && c.nodeName === '#text' ? c.value : '')).join(''),
		parent
	};
	const loc = e.sourceCodeLocation;
	if (loc) spans.push({ el, from: loc.startOffset, to: loc.endOffset });
	const content = e.tagName === 'template' ? (e as { content?: P5Node }).content : undefined;
	for (const k of [...e.childNodes, ...(content ? [content] : [])])
		kids.push(...from_parse5(k, el, spans));
	return [el];
}

/** A DOM element as an {@link El}. */
export function from_dom(node: Element, parent: El | null = null): El {
	const kids: El[] = [];
	const el: El = {
		tag: node.tagName.toLowerCase(),
		attr: (n) => node.getAttribute(n),
		names: [...node.attributes].map((a) => a.name),
		kids,
		text: node.textContent ?? '',
		parent
	};
	const content =
		node.tagName === 'TEMPLATE' ? (node as HTMLTemplateElement).content?.children : undefined;
	for (const k of [...node.children, ...(content ? [...content] : [])]) kids.push(from_dom(k, el));
	return el;
}

const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
/** Elements whose text is raw: their content is no markup. */
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const TOKEN =
	/<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * The tree the SOURCE says, before a parser repairs it: each start tag nested in the one open before
 * it, each end tag closing its own. The parser closes a `<p>` at a `<div>` and moves a table's stray
 * child out of it, silently (parse5 reports few tree errors), so what the server meant is read here;
 * an end tag that closes another element first is said too.
 */
export function source_tree(html: string): { roots: El[]; unbalanced: Lint[] } {
	const top: El[] = [];
	const unbalanced: Lint[] = [];
	const stack: Array<{ el: El; kids: El[] }> = [];
	TOKEN.lastIndex = 0;
	for (let m = TOKEN.exec(html); m !== null; m = TOKEN.exec(html)) {
		const [, end, start, raw_attrs, self] = m;
		if (end !== undefined) {
			const tag = end.toLowerCase();
			const at = stack.findLastIndex((s) => s.el.tag === tag);
			if (at === -1) {
				unbalanced.push({
					rule: `</${tag}> with no <${tag}> open`,
					where: stack.at(-1) ? path_of(stack.at(-1)!.el) : '(top)',
					app: messy(stack.at(-1)?.el ?? null)
				});
				continue;
			}
			if (at !== stack.length - 1) {
				const open = stack[stack.length - 1].el;
				unbalanced.push({
					rule: `</${tag}> closes <${open.tag}>`,
					where: path_of(open),
					app: messy(open)
				});
			}
			stack.length = at;
			continue;
		}
		if (start === undefined) continue;
		const tag = start.toLowerCase();
		const attrs = new Map<string, string>();
		ATTR.lastIndex = 0;
		for (let a = ATTR.exec(raw_attrs); a !== null; a = ATTR.exec(raw_attrs))
			if (!attrs.has(a[1].toLowerCase())) attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '');
		const kids: El[] = [];
		const parent = stack.at(-1);
		let text = '';
		if (RAW.has(tag)) {
			const close = html.toLowerCase().indexOf(`</${tag}`, TOKEN.lastIndex);
			const to = close === -1 ? html.length : close;
			text = html.slice(TOKEN.lastIndex, to);
			TOKEN.lastIndex = to;
		}
		const el: El = {
			tag,
			attr: (n) => attrs.get(n) ?? null,
			names: [...attrs.keys()],
			kids,
			text,
			parent: parent?.el ?? null
		};
		(parent ? parent.kids : top).push(el);
		if (!VOID.has(tag) && self !== '/' && !RAW.has(tag)) stack.push({ el, kids });
		else if (RAW.has(tag)) {
			// (its end tag comes next: the raw text was skipped)
			stack.push({ el, kids });
		}
	}
	return { roots: top, unbalanced };
}

/** Findings in one HTML answer: its parse errors (each in the element it falls in), the content
 *  model of the tree its source says, and its end tags that close another element first. `whole`:
 *  a document (a page), else a fragment (a hole's or a peer's answer). */
export function lint_html(html: string, whole: boolean): Lint[] {
	const errors: ParserError[] = [];
	const options = {
		sourceCodeLocationInfo: true,
		onParseError: (e: ParserError) => errors.push(e)
	};
	const tree = whole ? parse(html, options) : parseFragment(html, options);
	const spans: Array<{ el: El; from: number; to: number }> = [];
	from_parse5(tree as P5Node, null, spans);
	const source = source_tree(html);
	const roots = source.roots;
	const out: Lint[] = [...source.unbalanced];
	for (const e of errors) {
		// (the innermost element whose source holds the error)
		let at: El | null = null;
		let size = Infinity;
		for (const s of spans)
			if (s.from <= e.startOffset && e.startOffset < s.to && s.to - s.from < size) {
				at = s.el;
				size = s.to - s.from;
			}
		const near = html
			.slice(Math.max(0, e.startOffset - 30), e.startOffset + 30)
			.replace(/\s+/g, ' ');
		out.push({
			rule: `parse error ${e.code}`,
			where: `${at ? path_of(at) : '(top)'} near "${near}"`,
			app: messy(at)
		});
	}
	for (const r of roots) out.push(...content_model(r));
	return out;
}

/** Reported once each: a rule at a place, with an example of where it came from. */
function report(lints: Array<Lint & { from: string }>): string | null {
	const seen = new Map<string, string>();
	for (const l of lints) {
		if (l.app) continue;
		const key = `${l.rule} at ${l.where.replace(/ near ".*"$/, '')}`;
		if (!seen.has(key)) seen.set(key, `${l.rule} at ${l.where} (${l.from})`);
	}
	return seen.size === 0 ? null : [...seen.values()].sort().join('\n');
}

/** GOOD HTML SENT: every HTML answer the app's servers gave in the run, each text judged once. */
export async function html_sent(world: World): Promise<Broken | null> {
	const judged = new Set<string>();
	const lints: Array<Lint & { from: string }> = [];
	// (a server passes on what its hops brought, a mounted peer page whole: a document one of whose
	// hops the network changed holds bytes no server wrote; gen 178, test/html.test.ts. A cut hop is
	// a failure the app must answer well, as `faulted` says: still judged)
	const hops_faulted = new Set(
		world.network.exchanges.filter((e) => e.for !== undefined && e.tampered).map((e) => e.for!)
	);
	// (and a peer page the app kept from a tampered hop, `cache: { ttl }`: a later answer of that
	// page, any document's, is the changed copy; gen 195, seed 25)
	const kept_changed = world.network.exchanges
		.filter((e) => e.for !== undefined && e.tampered)
		.map((e) => new URL(e.url))
		.filter((u) => u.pathname.endsWith('/og/fragment/page'))
		.map((u) => u.searchParams.get('path'))
		.filter((p): p is string => p !== null);
	for (const a of world.html) {
		if (hops_faulted.has(a.from)) continue;
		if (kept_changed.some((p) => new URL(a.url).pathname.endsWith(p))) continue;
		const html = await a.html;
		if (html === '' || judged.has(html)) continue;
		judged.add(html);
		const path = new URL(a.url).pathname;
		for (const l of lint_html(html, a.whole)) lints.push({ ...l, from: path });
	}
	const detail = report(lints);
	return detail === null ? null : { oracle: 'html-sent', detail };
}

/** The reshape pass's marks (@ogygia/reshape: what ogygia puts on the HTML around the app's
 *  transform), every one of which the restore takes out before anything hydrates. */
const RESHAPE_ATTRS: ReadonlySet<string> = new Set([
	'og-h',
	'og-u',
	'og-c',
	'og-r',
	'og-shadow',
	'og-keep'
]);

/** A reshape mark a document holds at rest: a stand-in (`<og-as>`), a mark attribute, or a child's
 *  or text's comment mark (`og-c`, `og-t`). Each is ogygia's: the restore should have taken it
 *  out (restore.ts kept a stand-in: `reshape-stand-in-kept`). */
export function reshape_marks_left(root: Element): Lint[] {
	const out: Lint[] = [];
	const at = (el: Element) => {
		const parts: string[] = [];
		for (let e: Element | null = el, n = 0; e !== null && n < 4; e = e.parentElement, n++) {
			const gen = e.getAttribute('data-gen');
			parts.unshift(e.localName + (gen ? `[data-gen=${gen}]` : ''));
		}
		return parts.join(' > ');
	};
	const walk = (node: Node): void => {
		if (node.nodeType === 8) {
			const data = (node as Comment).data;
			if (data.startsWith('og-c ') || data.startsWith('og-t '))
				out.push({
					rule: `a reshape mark left (<!--${data.slice(0, 4)}-->)`,
					where: node.parentElement ? at(node.parentElement) : '(top)',
					app: false
				});
			return;
		}
		if (node.nodeType !== 1) return;
		const el = node as Element;
		if (el.localName === 'og-as')
			out.push({ rule: 'a reshape stand-in left (<og-as>)', where: at(el), app: false });
		for (const a of el.getAttributeNames())
			if (RESHAPE_ATTRS.has(a))
				out.push({ rule: `a reshape mark left (${a})`, where: at(el), app: false });
		for (const c of el.childNodes) walk(c);
	};
	walk(root);
	return out;
}

/** The body of ogygia's own error answer for a region (a render that threw: a 500). */
const ERROR_ANSWER = 'Region render failed';

/** A region error answer's body shown in the page: a hole keeps its fallback when its render
 *  throws, and an error answer is never swapped in (hole-fetch.ts `!res.ok`:
 *  `hole-error-answer-swapped-in`). */
export function error_answer_shown(root: Element): Lint[] {
	const out: Lint[] = [];
	const walker = root.ownerDocument.createTreeWalker(root, 4);
	for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
		if (!(n.textContent ?? '').includes(ERROR_ANSWER)) continue;
		const parts: string[] = [];
		for (let e = n.parentElement, i = 0; e !== null && i < 4; e = e.parentElement, i++) {
			const gen = e.getAttribute('data-gen');
			parts.unshift(e.localName + (gen ? `[data-gen=${gen}]` : ''));
		}
		out.push({ rule: 'an error answer shown', where: parts.join(' > '), app: false });
	}
	return out;
}

/** GOOD HTML KEPT: the document a tab shows at rest, whatever built it (navigations, morphs, answers
 *  swapped in), with none of the reshape pass's marks left. A document whose own HTML the network
 *  changed is set aside (`faulted`). */
export function html_kept(tab: Tab): Broken | null {
	const doc = tab.page.mainFrame.document as unknown as Document;
	if (!tab.page.mainFrame.url.startsWith('http') || doc.documentElement === null) return null;
	const lints = [
		...content_model(from_dom(doc.documentElement)),
		...reshape_marks_left(doc.documentElement),
		...error_answer_shown(doc.documentElement)
	].map((l) => ({
		...l,
		from: new URL(tab.page.mainFrame.url).pathname
	}));
	const detail = report(lints);
	return detail === null ? null : { oracle: 'html-kept', detail };
}
