// A TEST FILE THAT NAVIGATES MANY TIMES STAYS UNDER THE BROWSER'S HISTORY BUDGET. WebKit throws on
// more than 100 history writes per 10 s, and Firefox past its own budget (_browsers.ts
// `it_with_history_unthrottled`). Each write this file's page makes is counted; before a test, the
// file waits until the last 10 s hold room for that test's writes. Chromium has no budget.
import { ENGINE } from './_browsers.ts';

const WINDOW_MS = 10_500;
const BUDGET = 60;
const writes: number[] = [];

for (const name of ['pushState', 'replaceState'] as const) {
	const real = History.prototype[name];
	History.prototype[name] = function (this: History, ...args: Parameters<History['pushState']>) {
		writes.push(performance.now());
		return real.apply(this, args);
	};
}

/** Waits until the last 10 s of history writes leave room for `room` more. */
export async function history_room(room = 12): Promise<void> {
	if (ENGINE === 'chromium') return;
	for (;;) {
		const now = performance.now();
		while (writes.length > 0 && now - writes[0] > WINDOW_MS) writes.shift();
		if (writes.length + room <= BUDGET) return;
		await new Promise((resolve) => setTimeout(resolve, WINDOW_MS - (now - writes[0])));
	}
}
