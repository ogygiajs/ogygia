/**
 * AN APP'S CALLBACK THAT THREW where the loop it ran in must go on (a ref watcher, a scope disposer,
 * a page store subscriber, a navigation hook, a receipt seam, a devtools sink): the others still
 * run, and its error is not dropped. On a page it goes to the page's error handler (`reportError`:
 * the console and `window.onerror`, where error monitoring sees it), exactly as an uncaught throw
 * would, without stopping the loop. Where there is no such handler (a server, a test), it is
 * printed.
 */
export function report_thrown(error: unknown): void {
	const report = (globalThis as { reportError?: (e: unknown) => void }).reportError;
	if (typeof report === 'function') report(error);
	else console.error(error);
}
