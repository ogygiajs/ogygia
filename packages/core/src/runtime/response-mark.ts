/**
 * THE RESPONSE MARK, client side (contract/response-mark.ts, INVARIANTS RESPONSE-MARK): a side channel
 * of a document is the server's only when it bears the mark the document's head runtime script
 * bears. A document with no mark there has no side channel of the server's. Every reader of a
 * document-level channel finds it here. test/browser/side-channel-seeds.test.ts.
 */
import { RESPONSE_MARK } from '../contract/response-mark.ts';

const RUNTIME_SCRIPT = 'script[data-ogygia-runtime]';

/** `doc`'s mark: its head's first runtime script's ('' when it has none). */
export function mark_of(doc: Document): string {
	return doc.head?.querySelector(RUNTIME_SCRIPT)?.getAttribute(RESPONSE_MARK) || '';
}

/** Every element `selector` matches in `doc` that bears `doc`'s mark, in document order. */
export function server_channels(doc: Document, selector: string): Element[] {
	const mark = mark_of(doc);
	const out: Element[] = [];
	if (mark)
		for (const el of doc.querySelectorAll(selector))
			if (el.getAttribute(RESPONSE_MARK) === mark) out.push(el);
	return out;
}

/** The first element `selector` matches in `doc` that bears `doc`'s mark, or null. */
export function server_channel(doc: Document, selector: string): Element | null {
	const mark = mark_of(doc);
	if (mark)
		for (const el of doc.querySelectorAll(selector))
			if (el.getAttribute(RESPONSE_MARK) === mark) return el;
	return null;
}

/**
 * A navigation keeps the live head's runtime script (router-nav.ts `keep_head_node_across_spa`), so
 * the live document takes on the next document's mark here: its body, and the channels in it, are the
 * next response's from now on.
 */
export function adopt_mark(next: Document): void {
	const live = document.head?.querySelector(RUNTIME_SCRIPT);
	const mark = mark_of(next);
	if (!live) return;
	if (mark) live.setAttribute(RESPONSE_MARK, mark);
	else live.removeAttribute(RESPONSE_MARK);
}
