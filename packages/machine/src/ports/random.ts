import { realm } from './realm.ts';

/** A float in [0, 1). */
export const float = (): number => realm.Math.random();

/** `n` fresh random bytes. */
export const bytes = (n: number): Uint8Array => realm.crypto!.getRandomValues(new Uint8Array(n));

export { uuid } from './uuid.ts';
