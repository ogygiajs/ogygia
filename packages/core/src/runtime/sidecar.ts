/**
 * Where a region's props sidecar (`<script type="application/ogygia-props" data-ogygia-props>`) is,
 * in the region's own tree (the document, a fetched document, or a shadow root). Checked in order:
 * a sidecar restored onto the region (a hole Kit rendered again, ./hole-facts.ts); the tail's
 * keyed one (`id="og-props-<fp>"` for the region's `data-og-fp`); the region's next sibling past
 * `<link>` hints; then any script carrying its fingerprint (a document from before the tail's ids).
 * Tests: test/browser/sidecar-lane.test.ts, test/browser/hole-rebuild.test.ts.
 *
 * @packageDocumentation
 */
import { OG_FP, OGYGIA_PROPS } from '../wire-markup.ts';

const restored_sidecars = new WeakMap<Element, HTMLScriptElement>();

/** Attach a remembered props sidecar to a region whose DOM carries none (see above). */
export function restore_props_sidecar(region: Element, sidecar: HTMLScriptElement): void {
	restored_sidecars.set(region, sidecar);
}

export function props_sidecar_of(region: Element): HTMLScriptElement | null {
	const restored = restored_sidecars.get(region);
	if (restored) return restored;
	const fp = region.getAttribute(OG_FP);
	const root = region.getRootNode() as Document | ShadowRoot | Element;
	if (fp && 'getElementById' in root) {
		const keyed = root.getElementById(`og-props-${fp}`);
		if (keyed) return keyed as HTMLScriptElement;
	}
	let sib = region.nextElementSibling;
	while (sib) {
		if (sib.tagName === 'SCRIPT' && sib.hasAttribute(OGYGIA_PROPS)) return sib as HTMLScriptElement;
		if (sib.tagName === 'LINK') {
			sib = sib.nextElementSibling;
			continue;
		}
		break;
	}
	if (fp) {
		const found = (root as ParentNode).querySelector?.(`script[${OGYGIA_PROPS}="${fp}"]`);
		if (found) return found as HTMLScriptElement;
	}
	return null;
}
