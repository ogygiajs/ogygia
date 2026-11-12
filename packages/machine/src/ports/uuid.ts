import type { Platform } from '../ports.ts';

// (a module of its own, reading the realm itself: a wire island mints ids and nothing else of the
// ports, and a module it shared with the boot's ports was one more boot file; lazy-chunks.spec)
const realm = globalThis as unknown as Platform;

/** A v4 UUID; where the platform has none (a page not served over HTTPS), one made from fresh
 *  random bytes. */
export const uuid = (): string => {
	const made = realm.crypto?.randomUUID?.();
	if (made !== undefined) return made;
	const b = realm.crypto!.getRandomValues(new Uint8Array(16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = Array.from(b, (x) => (x + 256).toString(16).slice(1)).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
