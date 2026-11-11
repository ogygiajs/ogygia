// Which files held the first paint (src/runtime/render-blocking.ts): the browser's own per-file
// answer where it gives one, and where it does not (Safari, Firefox), the files the head makes
// blocking that started before the document was parsed.
import { afterEach, expect, test } from 'vitest';
import { paint_blocker } from '../../src/runtime/render-blocking.ts';

const proto = PerformanceResourceTiming.prototype as unknown as Record<string, unknown>;
const STATUS = Object.getOwnPropertyDescriptor(proto, 'renderBlockingStatus');
const added: Element[] = [];

afterEach(() => {
	for (const el of added.splice(0)) el.remove();
	if (STATUS) Object.defineProperty(proto, 'renderBlockingStatus', STATUS);
});

/** A browser that does not say per file what blocked the paint. */
function no_status() {
	if (STATUS) delete proto.renderBlockingStatus;
}

function head(markup: string) {
	const box = document.createElement('div');
	box.innerHTML = markup;
	for (const el of Array.from(box.children)) {
		// (as the parser inserts it: a script made by markup here is async unless told otherwise)
		if (el instanceof HTMLScriptElement && !el.hasAttribute('async')) el.async = false;
		document.head.append(el);
		added.push(el);
	}
}

const parsed = () =>
	(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).domInteractive;

/** A resource entry for `path`, started at `at` (ms). */
const entry = (path: string, at: number, status?: string) =>
	({
		name: new URL(path, location.href).href,
		startTime: at,
		renderBlockingStatus: status
	}) as unknown as PerformanceResourceTiming;

test('where the browser says it per file, its answer is the one read', () => {
	if (!STATUS) return; // (only Chromium says it)
	const held = paint_blocker();
	expect(held(entry('/a.css', 0, 'blocking'))).toBe(true);
	expect(held(entry('/b.css', 0, 'non-blocking'))).toBe(false);
});

test('without it: a stylesheet whose media applies, a classic sync script, and anything blocking="render" held the paint', () => {
	no_status();
	head(
		[
			'<link rel="stylesheet" href="/rb/all.css">',
			'<link rel="stylesheet" href="/rb/screen.css" media="screen">',
			'<link rel="stylesheet" href="/rb/print.css" media="print">',
			'<link rel="stylesheet" href="/rb/print-marked.css" media="print" blocking="render">',
			'<link rel="preload" href="/rb/preload.css" as="style">',
			'<script src="/rb/sync.js"></script>',
			'<script src="/rb/async.js" async></script>',
			'<script src="/rb/defer.js" defer></script>',
			'<script src="/rb/module.js" type="module"></script>',
			'<script src="/rb/module-marked.js" type="module" blocking="render"></script>'
		].join('')
	);
	const held = paint_blocker();
	const blocked = (path: string) => held(entry(path, 0));
	expect(blocked('/rb/all.css')).toBe(true);
	expect(blocked('/rb/screen.css')).toBe(true);
	expect(blocked('/rb/print.css')).toBe(false);
	expect(blocked('/rb/print-marked.css')).toBe(true);
	expect(blocked('/rb/preload.css')).toBe(false);
	expect(blocked('/rb/sync.js')).toBe(true);
	expect(blocked('/rb/async.js')).toBe(false);
	expect(blocked('/rb/defer.js')).toBe(false);
	expect(blocked('/rb/module.js')).toBe(false);
	expect(blocked('/rb/module-marked.js')).toBe(true);
});

test('without it: a head file that started after the document was parsed never held the paint', () => {
	no_status();
	head('<link rel="stylesheet" href="/rb/late.css">');
	const held = paint_blocker();
	expect(held(entry('/rb/late.css', parsed() - 1))).toBe(true);
	expect(held(entry('/rb/late.css', parsed() + 1))).toBe(false);
});
