// The element `selector` names in `<head>`, once it is there: a wait on the event, with no time
// bound of its own (the test's timeout is the bound), so a loaded runner cannot run it out.
export function in_head(selector: string): Promise<Element> {
	const now = document.head.querySelector(selector);
	if (now) return Promise.resolve(now);
	return new Promise((resolve) => {
		const seen = new MutationObserver(() => {
			const el = document.head.querySelector(selector);
			if (!el) return;
			seen.disconnect();
			resolve(el);
		});
		seen.observe(document.head, { childList: true, subtree: true });
	});
}
