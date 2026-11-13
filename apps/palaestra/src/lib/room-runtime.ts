import { createContext } from 'ogygia';
import type { SharedCounter } from './counter-object.svelte.js';

export const [getRoom, setRoom, hasRoom] = createContext<SharedCounter>('palaestra-room');
