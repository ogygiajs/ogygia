import { realm } from './realm.ts';

const read = (key: 'localStorage' | 'sessionStorage'): Storage | null => {
	try {
		return realm[key] ?? null;
	} catch {
		// ok: reading it throws where storage is blocked; null is "no storage here"
		return null;
	}
};

/** The page's local storage, or null where there is none or it may not be read. */
export const local = (): Storage | null => read('localStorage');

/** The page's session storage, or null where there is none or it may not be read. */
export const session = (): Storage | null => read('sessionStorage');
