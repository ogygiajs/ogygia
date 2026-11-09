// A code block's copy button (and its permalink) shows a tick for a moment after a copy. A clipboard
// that refuses (no permission, the page not focused) is the button's own business: never an
// unhandled rejection. A second copy within the tick's time keeps the tick for its full time: the
// first copy's tick does not end it early.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it } from 'vitest';
import CodeChrome from '../../src/site/components/CodeChrome.svelte';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function page() {
	const doc = document.createElement('div');
	doc.className = 'og-doc';
	doc.innerHTML = '<div class="og-body"><pre data-lang="js"><code>let a = 1;</code></pre></div>';
	const target = document.createElement('div');
	doc.append(target);
	document.body.append(doc);
	const app = mount(CodeChrome, { target });
	flushSync();
	const pre = doc.querySelector('pre')!;
	const copy = doc.querySelector<HTMLButtonElement>('.og-copy')!;
	const link = doc.querySelector<HTMLAnchorElement>('.og-code-link')!;
	return { pre, copy, link, done: () => unmount(app) };
}

/** The clipboard, for one test: `write` answers each copy. */
function clipboard(write: (text: string) => Promise<void>) {
	const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText: write }
	});
	return () => {
		delete (navigator as { clipboard?: unknown }).clipboard;
		if (real) Object.defineProperty(Navigator.prototype, 'clipboard', real);
	};
}

let restore: (() => void) | null = null;
afterEach(() => {
	restore?.();
	restore = null;
	document.body.replaceChildren();
});

it('a clipboard that refuses is no unhandled rejection, and shows no tick', async () => {
	restore = clipboard(() =>
		Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
	);
	const unhandled: unknown[] = [];
	const on_unhandled = (e: PromiseRejectionEvent) => {
		unhandled.push(e.reason);
		e.preventDefault();
	};
	window.addEventListener('unhandledrejection', on_unhandled);
	try {
		const { pre, copy, link, done } = page();
		copy.click();
		link.click();
		await sleep(100);
		expect(unhandled).toEqual([]);
		expect(pre.hasAttribute('data-copied')).toBe(false);
		expect(link.hasAttribute('data-linked')).toBe(false);
		await done();
	} finally {
		window.removeEventListener('unhandledrejection', on_unhandled);
	}
});

it('a second copy within the tick keeps the tick for its full time', async () => {
	restore = clipboard(() => Promise.resolve());
	const { pre, copy, link, done } = page();
	copy.click();
	link.click();
	await sleep(1000);
	copy.click();
	link.click();
	await sleep(700); // 1.7 s after the first copy, 0.7 s after the second
	expect(pre.hasAttribute('data-copied')).toBe(true);
	expect(link.hasAttribute('data-linked')).toBe(true);
	await sleep(1000); // past the second copy's tick
	expect(pre.hasAttribute('data-copied')).toBe(false);
	expect(link.hasAttribute('data-linked')).toBe(false);
	await done();
}, 10_000);
