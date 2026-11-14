import { readFileSync } from 'node:fs';

export const message = readFileSync(new URL('./message.txt', import.meta.url), 'utf8').trim();
