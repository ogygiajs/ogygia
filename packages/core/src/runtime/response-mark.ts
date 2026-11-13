/**
 * THE RESPONSE MARK, client side (contract/response-mark.ts, INVARIANTS RESPONSE-MARK): a side channel
 * of a document is the server's only when it bears the mark the document's head runtime script
 * bears. A document with no mark there has no side channel of the server's. Every reader of a
 * document-level channel finds it here (lazy chunks through the boot registry, runtime/slots.ts
 * `BootLink`). The mark is the head's first runtime script's. test/browser/side-channel-seeds.test.ts.
 *
 * @packageDocumentation
 */
import { RESPONSE_MARK } from '../contract/response-mark.ts';
import { OGYGIA_RUNTIME } from '../wire-markup.ts';
import { CODE_ORIGINS_ATTR, forget_code_origins } from './code-origins.ts';

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

const RESPONSE_FACTS = [RESPONSE_MARK, CODE_ORIGINS_ATTR] as const;

/**
 * A navigation keeps the live head's runtime script (router-nav.ts `keep_head_node_across_spa`), so
 * the live document takes on the next response's facts here, from the next document's first head
 * runtime script as a first load reads them: its mark (its body, and the channels in it, are the next
 * response's from now on) and its code origins (#1045), which the next ask reads again.
 */
export function adopt_response(next: Document): void {
	const live = document.head?.querySelector(`script[${OGYGIA_RUNTIME}]`);
	if (!live) return;
	const from = next.head?.querySelector(`script[${OGYGIA_RUNTIME}]`);
	for (const attr of RESPONSE_FACTS) {
		const value = from?.getAttribute(attr);
		if (value) live.setAttribute(attr, value);
		else live.removeAttribute(attr);
	}
	forget_code_origins();
}
