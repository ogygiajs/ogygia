// Waits on the thing itself, never on a clock: the test's own timeout is the only budget, so a busy
// machine makes a test slower, never red (#1430).

/** The first element under `root` that matches `selector`: now, or once one is put in. */
export function appears<E extends Element = Element>(
	selector: string,
	root: ParentNode & Node = document
): Promise<E> {
	const now = root.querySelector<E>(selector);
	if (now) return Promise.resolve(now);
	return new Promise((resolve) => {
		const watch = new MutationObserver(() => {
			const found = root.querySelector<E>(selector);
			if (!found) return;
			watch.disconnect();
			resolve(found);
		});
		watch.observe(root, { childList: true, subtree: true });
	});
}

/** A stylesheet link's sheet once it has loaded: at once if it has, else on its `load` event. A
 *  failed load rejects, so the test says why. */
export function sheet_loaded(link: HTMLLinkElement): Promise<CSSStyleSheet> {
	if (link.sheet) return Promise.resolve(link.sheet);
	return new Promise((resolve, reject) => {
		const done = new AbortController();
		link.addEventListener(
			'load',
			() => {
				done.abort();
				if (link.sheet) resolve(link.sheet);
				else reject(new Error(`${link.href} loaded without a sheet`));
			},
			{ signal: done.signal }
		);
		link.addEventListener(
			'error',
			() => {
				done.abort();
				reject(new Error(`${link.href} failed to load`));
			},
			{ signal: done.signal }
		);
	});
}
