import { realm } from './realm.ts';

/** A float in [0, 1). */
export const float = (): number => realm.Math.random();

/** `n` fresh random bytes. */
export const bytes = (n: number): Uint8Array => realm.crypto!.getRandomValues(new Uint8Array(n));

/** A v4 UUID; where the platform has none (a page not served over HTTPS), one made from `bytes`. */
export const uuid = (): string => {
	const made = realm.crypto?.randomUUID?.();
	if (made !== undefined) return made;
	const b = bytes(16);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = Array.from(b, (x) => (x + 256).toString(16).slice(1)).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
