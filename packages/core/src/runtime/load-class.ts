/**
 * A DOWNLOAD'S CLASS, AS A PRIORITY. Who waits for a download decides its class (load-scheduler.ts):
 * `user` (a visitor's gesture), `visible` (on screen now), `ahead` (not yet), `speculative` (a
 * guess). A shared download is a `flights()` flight, and a flight's priority is a number, higher
 * sooner: the class of the most urgent caller that joined it. A leaf, so a caller outside the boot
 * (`preload()`) says its class without loading the scheduler.
 */
export type LoadClass = 'user' | 'visible' | 'ahead' | 'speculative';

/** Each class as a flight priority (`flights().get(…, { priority })`): higher is sooner. */
export const PRIORITY: Readonly<Record<LoadClass, number>> = {
	speculative: 0,
	ahead: 1,
	visible: 2,
	user: 3
};

/** The classes, most urgent first (`CLASSES[3 - PRIORITY[c]] === c`). */
export const CLASSES: readonly LoadClass[] = ['user', 'visible', 'ahead', 'speculative'];

/** The class a flight at `priority` downloads at (a priority above `user` is `user`). */
export function class_at(priority: number): LoadClass {
	if (priority >= 3) return 'user';
	if (priority >= 2) return 'visible';
	return priority >= 1 ? 'ahead' : 'speculative';
}

const FETCH_PRIORITY: Readonly<Record<LoadClass, 'high' | 'auto' | 'low'>> = {
	user: 'high',
	visible: 'auto',
	ahead: 'low',
	speculative: 'low'
};

/** The fetch priority a class downloads at (`fetch(…, { priority })`, `<link fetchpriority>`). */
export function fetch_priority_of(cls: LoadClass): 'high' | 'auto' | 'low' {
	return FETCH_PRIORITY[cls];
}
