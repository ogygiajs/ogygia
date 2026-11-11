import type { Platform } from '../ports.ts';

/** The platform of the realm the code runs in, read at each call (never kept). */
export const realm = globalThis as unknown as Platform;
