import { realm } from './realm.ts';

/** An IntersectionObserver, or null where there is none (a server). */
export const observer = (
	callback: IntersectionObserverCallback,
	options?: IntersectionObserverInit
): IntersectionObserver | null =>
	realm.IntersectionObserver === undefined
		? null
		: new realm.IntersectionObserver(callback, options);
