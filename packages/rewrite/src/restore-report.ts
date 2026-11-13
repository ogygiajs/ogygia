/**
 * SAY WHAT THE RESTORER RECORDED. The restorer (./restore.ts) runs inlined as text, self-contained,
 * so it prints nothing itself: it records each mismatch on `window.__og_restore_log` (the devtools
 * and the beacon read it too). The boot reports what the document's own run recorded, and wraps
 * `window.__og_restore` so every later run — a hole answer, a router swap — reports its own.
 */
import { say } from '@ogygia/machine';
import type { PageGlobals } from '@ogygia/core/plugin/client';

let reported = 0;
/** The element names a late restore was said for on this page (once each, the latest 1024). */
const late_said = say();
const sheet_said = say();
const invalid_said = say();

function report(): void {
	const log = (window as PageGlobals).__og_restore_log;
	if (!log) return;
	// (a log made anew, a test's: start from its top)
	if (reported > log.length) reported = 0;
	const fresh = log.slice(reported);
	reported = log.length;
	if (
		!fresh.some(
			(e) =>
				(e.kind === 'mismatch' && e.diff) ||
				((e.kind === 'late' || e.kind === 'invalid') && e.host) ||
				(e.kind === 'sheet' && e.key)
		)
	)
		return;
	const say_them = ({ OgygiaError, warn }: typeof import('./messages.ts')) => {
		for (const entry of fresh) {
			if (entry.kind === 'mismatch' && entry.diff)
				console.error(new OgygiaError('restore_markup_broken', { diff: entry.diff }));
			// in every build: a late host loses nothing now, but it shows a part of the page late (#382)
			else if (entry.kind === 'late' && entry.host) {
				const host = entry.host;
				late_said.once(host, () => warn('restore_late', { host }));
			} else if (entry.kind === 'sheet' && entry.key) {
				const { host, key } = entry;
				sheet_said.once(key, () => warn('restore_sheet_missing', { host, key }));
			} else if (entry.kind === 'invalid' && entry.host) {
				const host = entry.host;
				invalid_said.once(host, () => warn('restore_host_invalid', { host }));
			}
		}
	};
	// (the wording loads only when there is something to say: the boot carries none of it)
	import('./messages.ts').then(say_them, () => {}); // ok: its chunk did not load; the log stays on window.__og_restore_log for the devtools and the beacon
}

export function report_restores(): void {
	if (typeof window === 'undefined') return;
	const w = window as PageGlobals;
	const run = w.__og_restore;
	if (run)
		w.__og_restore = (root, lite) => {
			const restored = run(root, lite);
			report();
			return restored;
		};
	report();
}
