/**
 * SAY WHAT THE RESTORER RECORDED. The restorer (./restore.ts) runs inlined as text, self-contained,
 * so it prints nothing itself: it records each mismatch on `window.__og_restore_log` (the devtools
 * and the beacon read it too). The boot reports what the document's own run recorded, and wraps
 * `window.__og_restore` so every later run — a hole answer, a router swap — reports its own.
 */
import { OgygiaError } from '../messages/core.ts';

type RestoreWindow = {
	__og_restore?: (root: ParentNode) => number;
	__og_restore_log?: { kind: 'late' | 'mismatch'; diff?: string }[];
};

let reported = 0;

function report(): void {
	const log = (window as RestoreWindow).__og_restore_log;
	if (!log) return;
	for (; reported < log.length; reported++) {
		const entry = log[reported];
		if (entry.kind === 'mismatch' && entry.diff)
			console.error(new OgygiaError('restore_markup_broken', { diff: entry.diff }));
	}
}

export function report_restores(): void {
	if (typeof window === 'undefined') return;
	const w = window as RestoreWindow;
	const run = w.__og_restore;
	if (run)
		w.__og_restore = (root) => {
			const restored = run(root);
			report();
			return restored;
		};
	report();
}
