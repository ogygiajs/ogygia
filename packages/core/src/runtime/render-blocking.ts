/**
 * Which files held the first paint. Chromium says it per file (`renderBlockingStatus`); Safari and
 * Firefox say nothing, so there it is the files the document's head makes blocking (a stylesheet
 * whose media applies, a classic script with neither async nor defer, anything marked
 * `blocking="render"`) that started before the document was parsed.
 *
 * @packageDocumentation
 */

type WithStatus = PerformanceResourceTiming & { renderBlockingStatus?: string };

function status_known(): boolean {
	return (
		typeof PerformanceResourceTiming !== 'undefined' &&
		'renderBlockingStatus' in PerformanceResourceTiming.prototype
	);
}

function head_blockers(): Set<string> | null {
	if (status_known() || typeof document === 'undefined' || !document.head) return null;
	const out = new Set<string>();
	for (const el of document.head.querySelectorAll('link[href],script[src]')) {
		const marked = (el.getAttribute('blocking') ?? '').split(' ').includes('render');
		if (el instanceof HTMLLinkElement) {
			if (!el.relList.contains('stylesheet') || el.disabled) continue;
			const media = el.media.trim();
			if (marked || !media || media === 'all' || matchMedia(media).matches) out.add(el.href);
		} else if (el instanceof HTMLScriptElement) {
			const type = el.type.trim().toLowerCase();
			const classic = !type || type === 'text/javascript' || type === 'application/javascript';
			if (marked || (classic && !el.async && !el.defer)) out.add(el.src);
		}
	}
	return out;
}

/** `(r) => did r hold the first paint`, read once for a pass over many entries */
export function paint_blocker(): (r: PerformanceResourceTiming) => boolean {
	const head = head_blockers();
	if (!head) return (r) => (r as WithStatus).renderBlockingStatus === 'blocking';
	const parsed =
		(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
			?.domInteractive || Infinity;
	return (r) => head.has(r.name) && r.startTime < parsed;
}
