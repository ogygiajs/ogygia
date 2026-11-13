/**
 * How far the page's own fixed chrome at the bottom of the viewport (a phone's bottom bar) rises at
 * `x`, in px: the launcher rests above it, so it never covers the page's buttons. A fixed or sticky
 * element counts when it touches the viewport's bottom edge and takes at most a third of its height
 * (a full-screen overlay is not chrome). 0 when nothing is pinned there. `own` is the dock's host,
 * never counted.
 */
export function bottom_chrome(x: number, own: Element): number {
	const doc = own.ownerDocument;
	const view = doc.defaultView;
	if (!view) return 0;
	const height = view.innerHeight;
	for (const hit of doc.elementsFromPoint(x, height - 1)) {
		if (hit === own || own.contains(hit)) continue;
		for (
			let el: Element | null = hit;
			el && el !== doc.body && el !== doc.documentElement;
			el = el.parentElement
		) {
			const { position } = view.getComputedStyle(el);
			if (position !== 'fixed' && position !== 'sticky') continue;
			const rect = el.getBoundingClientRect();
			if (rect.bottom >= height - 1 && rect.height <= height / 3) return height - rect.top;
		}
	}
	return 0;
}
