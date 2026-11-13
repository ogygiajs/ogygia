/**
 * A web component's own class tokens survive hydration. Svelte's hydration writes a custom
 * element's `class` whole (svelte `set_class`), dropping the tokens the component put on its own
 * host. For each custom element the restorer reset (./restore.ts records Svelte's class as
 * `__og_svelte_class`), the tokens that are not Svelte's are noted just before the island's hydrate
 * and put back after it. Svelte's own tokens are never put back, and an element hydration replaced
 * is left alone (test/browser/host-classes.test.ts).
 *
 * @packageDocumentation
 */

/** The expando the restorer writes on a custom element it reset: Svelte's class, as Svelte rendered it. */
export const SVELTE_CLASS = '__og_svelte_class';

type Hosted = Element & { [SVELTE_CLASS]?: string };

/** Each restored custom element under `region` with tokens that are not Svelte's: [host, tokens]. */
export function note_host_classes(region: Element): Array<[Element, string[]]> | null {
	let out: Array<[Element, string[]]> | null = null;
	for (const el of region.getElementsByTagName('*')) {
		const svelte = (el as Hosted)[SVELTE_CLASS];
		if (svelte === undefined) continue;
		const own = new Set(svelte.split(' '));
		let theirs: string[] | null = null;
		for (const t of el.classList) if (!own.has(t)) (theirs ??= []).push(t);
		if (theirs) (out ??= []).push([el, theirs]);
	}
	return out;
}

/** Put back the component's tokens a hydration write removed. */
export function keep_host_classes(noted: Array<[Element, string[]]> | null): void {
	if (!noted) return;
	for (const [el, theirs] of noted) {
		// @why hydration replaced it: the fresh element is the component's to dress (test: test/browser/host-classes.test.ts › an element hydration replaced gets nothing put back: the element left the page)
		if (!el.isConnected) continue;
		for (const t of theirs) if (!el.classList.contains(t)) el.classList.add(t);
	}
}
