/** The address this document was loaded at: its navigation's, which a same-document step through
 *  history (a Back the page's scripts did not hear yet) does not move, unlike `location`. */
export function document_address(): string {
	const loaded =
		typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
			? performance.getEntriesByType('navigation')[0]?.name
			: undefined;
	return loaded || location.href;
}
