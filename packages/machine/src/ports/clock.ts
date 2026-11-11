import { realm } from './realm.ts';

/** Milliseconds on the monotonic clock, for a duration inside one process (#472). */
export const mono = (): number => (realm.performance ?? realm.Date).now();

/** Milliseconds since the epoch, for a timestamp that leaves the process (#472). */
export const wall = (): number => realm.Date.now();
