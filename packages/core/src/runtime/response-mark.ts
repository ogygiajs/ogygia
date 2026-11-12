/**
 * THE RESPONSE MARK, client side (contract/response-mark.ts, INVARIANTS RESPONSE-MARK): a side channel
 * of a document is the server's only when it bears the mark the document's head runtime script
 * bears. A document with no mark there has no side channel of the server's. Every reader of a
 * document-level channel finds it here (lazy chunks through the boot registry, runtime/slots.ts
 * `BootLink`). test/browser/side-channel-seeds.test.ts.
 */
import { RESPONSE_MARK } from '../contract/response-mark.ts';
import { OGYGIA_RUNTIME } from '../wire-markup.ts';

/** `doc`'s mark: its head's first runtime script's. */
const mark_of = (doc: Document) =>
	doc.head?.querySelector(`script[${OGYGIA_RUNTIME}]`)?.getAttribute(RESPONSE_MARK);

/** Every element `selector` matches in `doc` that bears `doc`'s mark, in document order. */
export function server_channels(doc: Document, selector: string): Element[] {
	const mark = mark_of(doc);
	return mark
		? [...doc.querySelectorAll(selector)].filter((el) => el.getAttribute(RESPONSE_MARK) === mark)
		: [];
}

/** The first element `selector` matches in `doc` that bears `doc`'s mark, or null. */
export function server_channel(doc: Document, selector: string): Element | null {
	return server_channels(doc, selector)[0] ?? null;
}

/**
 * A navigation keeps the live head's runtime script (router-nav.ts `keep_head_node_across_spa`), so
 * the live document takes on the next document's mark here: its body, and the channels in it, are the
 * next response's from now on.
 */
export function adopt_mark(next: Document): void {
	const live = document.head?.querySelector(`script[${OGYGIA_RUNTIME}]`);
	const mark = mark_of(next);
	if (!live) return;
	if (mark) live.setAttribute(RESPONSE_MARK, mark);
	else live.removeAttribute(RESPONSE_MARK);
}
