/**
 * THE HTML SINK (HOLE-TRUST, internal/notes/INVARIANTS.md): the one module where a string becomes
 * DOM. A leaf (no imports). Everything else hands it a {@link VerifiedHtml}, and the only way to have
 * one is a voucher below, each named by what it checked: a region answer from a same-origin endpoint
 * that stayed same-origin, a page fetch that landed on this origin, HTML the page itself holds, or an
 * answer of the app's own remote transport. The string-to-DOM APIs (`setHTMLUnsafe`, `innerHTML =`,
 * `DOMParser`, `createContextualFragment`, …) and a cast to `VerifiedHtml` are a lint error anywhere
 * else in package source (`ogygia/html-sink`).
 */

import type { PageGlobals } from '../page-globals.ts';

declare const VERIFIED: unique symbol;

/** HTML a voucher of this module vouched for: the only input the sink takes. */
export type VerifiedHtml = string & { readonly [VERIFIED]: true };

/**
 * Defense-in-depth: only fetch region HTML from same-origin capability URLs. Mint always emits a
 * path-only URL (`resolve(DEFAULT_ISLANDS_ENDPOINT)?…`). Absolute / protocol-relative endpoints would
 * require prior HTML injection — still reject them so the runtime is not an XSS amplifier.
 * True when `endpoint` resolves to same-origin http(s).
 */
export function is_allowed_region_endpoint(
	endpoint: string,
	page_origin: string = location.origin
): boolean {
	if (typeof endpoint !== 'string' || endpoint.length === 0) return false;
	try {
		const url = new URL(endpoint, page_origin);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
		if (url.origin !== page_origin) return false;
		// Reject if the final response could redirect cross-origin — checked by caller via res.url.
		return true;
	} catch {
		return false; // ok: not a URL: refused (fail closed)
	}
}

/** After fetch: reject opaque redirects that left the page origin. */
export function is_same_origin_response(
	res: Response,
	page_origin: string = location.origin
): boolean {
	if (!res.url) return true; // older environments — rely on request URL check
	try {
		return new URL(res.url).origin === page_origin;
	} catch {
		return false; // ok: not a URL: refused (fail closed)
	}
}

/** A region endpoint's answer (a hole, a batch's parcel, a 204's marker): vouched when the endpoint
 *  is same-origin and the response ended there. Null otherwise. */
export function vouch_region_answer(
	endpoint: string,
	res: Response,
	text: string
): VerifiedHtml | null {
	return is_allowed_region_endpoint(endpoint) && is_same_origin_response(res)
		? (text as VerifiedHtml)
		: null;
}

/** A page the router fetched: vouched when the address it landed on is this origin. Null otherwise. */
export function vouch_page_answer(landed: URL, html: string): VerifiedHtml | null {
	return landed.origin === location.origin ? (html as VerifiedHtml) : null;
}

/** HTML the page itself holds (a region's own markup, a record the server wrote into the page):
 *  exactly as trusted as the page. */
export function vouch_page_html(html: string): VerifiedHtml {
	return html as VerifiedHtml;
}

/** An answer of the app's own remote transport (Kit's remote functions: its own endpoint, its own
 *  same-origin fetch): HTML our server rendered in-process. */
export function vouch_remote_answer(html: string): VerifiedHtml {
	return html as VerifiedHtml;
}

/** A page's whole document, parsed (inert: nothing in it runs). */
export function parse_page_document(html: VerifiedHtml): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

/** An element's children replaced by `html`'s, parsed in its own document. */
export function set_inner_html(el: Element, html: VerifiedHtml): void {
	el.innerHTML = html;
}

/**
 * Region / SSR HTML into a fragment. Every parse site shares it: `region_fragment` (a fetched hole /
 * live tick / held region), `repair_if_drifted` (the server copy an island hydrates against), and
 * anything added later. Having ONE parser is the point — a second, DSD-unaware one would silently
 * drift (see below).
 *
 * `<template shadowrootmode>` (declarative shadow DOM — a web STANDARD, nothing library-specific) turns
 * into a real shadow root ONLY when a DSD-aware parser reads it. `Element.setHTMLUnsafe()` is that
 * parser — the very algorithm the document uses on first load — so a server-painted region body arrives
 * with its shadow roots live, exactly as the initial page paints. `createContextualFragment` /
 * `innerHTML` / `DOMParser` are all DSD-UNAWARE by spec: they leave the `<template>` inert, so any host
 * that renders its box from inside its shadow paints at 0 height until its own runtime upgrades it (the
 * swap-then-blank-then-paint flicker). "Unsafe" means only "no sanitizer"; a region body is our own
 * signed, same-origin SSR (HOLE-TRUST), so it is exactly as trusted as the page itself.
 *
 * INERT BY CONSTRUCTION (#382). The parse runs in a document with no browsing context (one per
 * runtime, made on first use): it has no custom element registry, so nothing in the answer is built
 * by a component's constructor before the restore (./restore.ts) puts it in shape, in any engine.
 * A page-owned `<template>` was inert by a browser detail only: Firefox 159 (scoped registries)
 * builds custom elements while one parses with `setHTMLUnsafe`, so a host had its constructor's
 * root before the restore reached it. Attaching a declarative shadow root is a parse step, not an
 * upgrade: it still happens here. The fragment's nodes belong to that document until they are
 * inserted (insertion adopts them; they upgrade at connect, constructor then `connectedCallback`,
 * a declarative root kept). `repair_if_drifted` needs this too: the server copy stays inert, and its
 * light-DOM sequence is DSD-consistent with a live region whose hosts already carry shadow roots.
 *
 * (`Document.parseHTMLUnsafe` would also parse without a registry, but makes a whole document per
 * call; one shared document and its template is the cheaper of the two.)
 *
 * In dev and e2e every parse is checked (`rule_parse_upgraded`, ./rules.ts): nothing built.
 */
export function parse_region_html(html: VerifiedHtml): DocumentFragment {
	const tpl = inert_document().createElement('template');
	const set_html_unsafe = (tpl as { setHTMLUnsafe?: (h: string) => void }).setHTMLUnsafe;
	if (typeof set_html_unsafe === 'function') {
		set_html_unsafe.call(tpl, html);
	} else {
		tpl.innerHTML = html;
		attach_declarative_shadows(tpl.content);
	}
	(globalThis as PageGlobals).__og_parsed?.(tpl.content);
	return tpl.content;
}

let inert: Document | null = null;
/** The runtime's one document with no browsing context, made on first use. (A DOM with no
 *  `document.implementation`, a server-side DOM a bench runs on, parses in the page's own: it has
 *  no custom elements to build.) */
function inert_document(): Document {
	return (inert ??=
		typeof document.implementation?.createHTMLDocument === 'function'
			? document.implementation.createHTMLDocument('')
			: document);
}

/** The spec's declarative-shadow-DOM attach step, for engines that render DSD on first parse but predate
 *  `setHTMLUnsafe`. Recurse into each shadow we attach: `querySelectorAll` stops at shadow boundaries,
 *  and a `<template shadowrootmode>` can nest inside another. First template per host wins (a host already
 *  carrying a shadow root is left as is). */
export function attach_declarative_shadows(root: DocumentFragment | ShadowRoot): void {
	for (const node of Array.from(root.querySelectorAll('template[shadowrootmode]'))) {
		const tpl = node as HTMLTemplateElement;
		const host = tpl.parentElement;
		tpl.remove();
		if (!host || host.shadowRoot) continue;
		const shadow = host.attachShadow({
			mode: tpl.getAttribute('shadowrootmode') === 'closed' ? 'closed' : 'open',
			delegatesFocus: tpl.hasAttribute('shadowrootdelegatesfocus')
		});
		shadow.append(tpl.content);
		attach_declarative_shadows(shadow);
	}
}

/**
 * Shadow roots attached while the markup sat in an inert document — a declarative shadow root the
 * parse above attached, a restored one — get no custom element registry in a browser with scoped
 * registries, and keep none once inserted: nothing inside them upgrades (an element that calls
 * `attachInternals` in its constructor throws). Give each the page's registry, right after the
 * insertion. A browser without scoped registries never nulls it (and has no `initialize`): a no-op.
 */
export function init_shadow_registries(under: Node): void {
	const ce = customElements as CustomElementRegistry & { initialize?: (root: Node) => void };
	if (typeof ce.initialize !== 'function') return;
	const scopes: Node[] = [under];
	for (let q = 0; q < scopes.length; q++) {
		const walk = document.createTreeWalker(scopes[q], 1 /* SHOW_ELEMENT */);
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			const sr = (n as Element).shadowRoot as
				| (ShadowRoot & { customElementRegistry?: unknown })
				| null;
			if (!sr) continue;
			if (sr.customElementRegistry === null) ce.initialize(sr);
			scopes.push(sr);
		}
	}
}
