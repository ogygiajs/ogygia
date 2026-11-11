/**
 * Detect whether a document is a Kit csr=true page (Kit boots and hydrates the tree).
 * Must NOT treat ogygia side-channel scripts as evidence — their payloads can reflect
 * attacker-controlled URL substrings like `__sveltekit_` (P0).
 */
import { runtime_session } from './session.ts';
import { OGYGIA_PAGE, OGYGIA_PROPS, OGYGIA_REMOTE } from '../wire-markup.ts';

const KIT_ASSIGN = /__sveltekit_\w+\s*=/;

/** Whether an inline script (no `src`) is Kit's boot: it assigns a `__sveltekit_*` global, and it is
 *  not one of ogygia's side-channel scripts (their payload may echo the URL). The DOM probe below and
 *  the server's string probe (server/html-scan.ts) both ask this. */
export function is_kit_boot_script(
	type: string,
	has: (attr: string) => boolean,
	text: string
): boolean {
	if (type.startsWith('application/ogygia-')) return false;
	if (has(OGYGIA_PROPS) || has(OGYGIA_PAGE) || has(OGYGIA_REMOTE)) return false;
	return KIT_ASSIGN.test(text);
}

export class KitBoot {
	/**
	 * The route fact, when the server stamped it: `<meta name="ogygia-csr" content="true">` on a
	 * csr=true document. `null` when the document carries no such meta (an older document, a
	 * fragment) — then the inline-script probe below decides.
	 */
	static meta_of(doc: ParentNode): boolean | null {
		const meta = doc.querySelector('meta[name="ogygia-csr"]');
		return meta ? meta.getAttribute('content') === 'true' : null;
	}

	/** Meta first; else ONE probe over the document's inline scripts (side-channel scripts skipped). */
	static document_has(doc: ParentNode = document): boolean {
		const meta = KitBoot.meta_of(doc);
		if (meta !== null) return meta;
		for (const s of doc.querySelectorAll('script:not([src])'))
			if (
				is_kit_boot_script(
					s.getAttribute('type') || '',
					(a) => s.hasAttribute(a),
					s.textContent || ''
				)
			)
				return true;
		return false;
	}
}

/**
 * Mixed mode: on a csr=true page, Kit boots and hydrates the whole tree (including our island
 * components). THE one answer for the live document — read once (the meta, else the probe), cached
 * on the session, cleared when the router prepares the next document. Every caller (the region
 * element's guards, the router's start, the wrapper's client leg) reads this cache; none probes
 * the document on its own.
 */
export function kit_hydrates_page(): boolean {
	if (runtime_session.kit_page === undefined) {
		runtime_session.kit_page = typeof document !== 'undefined' && KitBoot.document_has(document);
	}
	return runtime_session.kit_page;
}
