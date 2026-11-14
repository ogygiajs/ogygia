// What every region grid case and every fuzzed input must hold, whatever it rendered: Svelte's
// hydration markers balanced in each parent, and the page good HTML (the simulator's own lint:
// parse errors, the content model, end tags that close another element).
import { parse_document } from '@ogygia/config/html-fuzz';
import { lint_html } from '../../../internal/sim/src/html.ts';

type Doc = ReturnType<typeof parse_document>;
type Parent = Doc | { childNodes: Node[]; nodeName: string };
type Node = {
	nodeName: string;
	data?: string;
	tagName?: string;
	childNodes?: Node[];
	content?: Parent;
};

const OPEN = /^\[[!?]?(?:-?\d+)?$/;
const CLOSE = /^\]$/;

/** Where Svelte's hydration markers do not pair up: in each element, every `<!--[…-->` closed by a
 *  `<!--]-->` among the same siblings, none closed before it opens. Empty when they all pair. */
export function unbalanced_markers(html: string): string[] {
	const doc = parse_document(`<!doctype html><html><head></head><body>${html}</body></html>`);
	const out: string[] = [];
	const walk = (node: Parent, path: string) => {
		let depth = 0;
		for (const child of node.childNodes as Node[]) {
			if (child.nodeName === '#comment') {
				const data = child.data ?? '';
				if (OPEN.test(data)) depth++;
				else if (CLOSE.test(data) && --depth < 0) {
					out.push(`a <!--]--> with no open marker in ${path}`);
					depth = 0;
				}
			} else if (child.childNodes) {
				walk(child as Parent, `${path} > ${child.tagName ?? child.nodeName}`);
			}
			if (child.nodeName === 'template' && child.content) walk(child.content, `${path} > template`);
		}
		if (depth > 0) out.push(`${depth} marker(s) left open in ${path}`);
	};
	walk(doc, '');
	return out;
}

/** The lint findings of the whole page the parts make: the head's in `<head>`, the body and the tail
 *  in `<body>`. Empty when the HTML is good. */
export function html_findings(head: string, body: string, tail = ''): string[] {
	const page = `<!doctype html><html><head><title>t</title>${head}</head><body>${body}${tail}</body></html>`;
	return lint_html(page, true).map((l) => `${l.rule} at ${l.where}`);
}
