/**
 * THE OWNERS OF A REGION HEAD TAG (#806, #854): the outermost islands it belongs to, by fingerprint.
 * A tag names them in `data-og-owner`, space-separated. The server writes a shared sheet once per
 * request, naming the first island that linked it, and lists the others in the document tail
 * (`<script type="application/json" data-og-owners>`: sheet identity → fingerprints). The router
 * adds those to the tag, and the owners a later page's copy of the tag names; a navigation keeps the
 * tag while any owner is on the page (runtime/region-sheets.ts `release_head_nodes`).
 *
 * Imports only the markup vocabulary: the server (document-tail.ts), the boot (region-sheets.ts) and
 * the router's chunk (router-nav.ts) share it, and the runtime reaches no server code through it.
 */
import { OG_OWNER, OG_OWNERS, OGYGIA_REGION_CSS } from './wire-markup.ts';

export const HEAD_OWNERS_ATTR: typeof OG_OWNERS = OG_OWNERS;

/** The owners a head tag names (`data-og-owner`). */
export function head_owners(node: Element): string[] {
	const attr = node.getAttribute(OG_OWNER);
	return attr ? attr.split(' ').filter(Boolean) : [];
}

/** Name `more` as owners of a head tag too, each once, after the ones it names. */
export function add_head_owners(node: Element, more: Iterable<string>): void {
	const list = head_owners(node);
	const before = list.length;
	for (const o of more) if (o && !o.includes(' ') && !list.includes(o)) list.push(o);
	if (list.length !== before) node.setAttribute(OG_OWNER, list.join(' '));
}

/**
 * Add the owners a document's tail lists (`data-og-owners`) to the region sheets in the live head
 * they name: each by its identity, the resolved href its tag carries (`data-ogygia-region-css`'s
 * value on an inlined `<style>`, its `href` on a `<link>`). A record that does not parse adds nothing.
 */
export function adopt_owner_record(doc: ParentNode, head: ParentNode): void {
	const script = doc.querySelector(`script[${HEAD_OWNERS_ATTR}]`);
	if (!script) return;
	let record: Record<string, unknown>;
	try {
		record = JSON.parse(script.textContent || '{}') as Record<string, unknown>;
		// oxlint-disable-next-line ogygia/no-silent-failures -- a record that does not parse names no owner: its sheets keep the owners their tags name
	} catch {
		return;
	}
	if (record === null || typeof record !== 'object') return;
	for (const node of Array.from(head.querySelectorAll(`[${OGYGIA_REGION_CSS}]`))) {
		const identity = node.getAttribute(OGYGIA_REGION_CSS) || node.getAttribute('href');
		const owners = identity !== null && Object.hasOwn(record, identity) ? record[identity] : null;
		if (Array.isArray(owners))
			add_head_owners(
				node,
				owners.filter((o): o is string => typeof o === 'string')
			);
	}
}
