// An edit under a real Vite dev server, for the tests that edit files and wait for dev to run a
// module again (core's and content's dev tests): written as an editor saves, and done once the
// dev server's watcher reports it.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FSWatcher } from 'vite';

/** Vite's watcher (chokidar) reports a change of a file at most once in this long: a change of the
 *  same file inside it is folded into the one before, and never reported. On Linux inotify reports a
 *  write at once, so a test's next edit of that file landed inside it (macOS reports later, so it did
 *  not); no editor saves twice that fast. (50 ms in chokidar, and a little more.) */
const FOLD_MS = 60;
/** When the watcher last reported each file an edit wrote, by watcher. */
const reported = new WeakMap<FSWatcher, Map<string, number>>();

/** Write `text` to `file` (absolute) as an edit: once `watcher` watches it, and once the watcher's
 *  last report of it is old enough not to fold this one in. Resolves when the watcher reports it. */
export async function edit(watcher: FSWatcher, file: string, text: string): Promise<void> {
	const until = Date.now() + 10_000;
	while (!watcher.getWatched()[path.dirname(file)]?.includes(path.basename(file))) {
		if (Date.now() > until) throw new Error(`the watcher never watched ${file}`);
		await new Promise((r) => setTimeout(r, 10));
	}
	const times = reported.get(watcher) ?? new Map<string, number>();
	reported.set(watcher, times);
	const fold = (times.get(file) ?? 0) + FOLD_MS - Date.now();
	if (fold > 0) await new Promise((r) => setTimeout(r, fold));

	const report = new Promise<void>((resolve, reject) => {
		const on = (event: string, at: string): void => {
			if ((event !== 'change' && event !== 'add') || path.resolve(at) !== file) return;
			times.set(file, Date.now());
			clearTimeout(timer);
			watcher.off('all', on);
			resolve();
		};
		const timer = setTimeout(() => {
			watcher.off('all', on);
			reject(new Error(`the watcher never reported the edit of ${file}`));
		}, until - Date.now());
		watcher.on('all', on);
	});
	writeFileSync(file, text);
	await report;
}
