import type { Scope } from '@ogygia/machine';

/**
 * Replace `target[key]` until `owner` closes: `make` gets the original (to call with its own
 * receiver) and returns the stand-in. Closing the scope puts back the exact property there was
 * (or none, when the key was inherited), once.
 */
export function patch<T extends object, K extends keyof T>(
	owner: Scope,
	target: T,
	key: K,
	make: (original: T[K]) => T[K]
): void {
	const saved = Object.getOwnPropertyDescriptor(target, key);
	Object.defineProperty(target, key, {
		value: make(target[key]),
		configurable: true,
		writable: true,
		enumerable: saved?.enumerable ?? true
	});
	owner.defer(() => {
		if (saved) Object.defineProperty(target, key, saved);
		else Reflect.deleteProperty(target, key);
	});
}
