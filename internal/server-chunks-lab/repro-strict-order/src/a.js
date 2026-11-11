// a and b import each other (a cycle). No top-level await anywhere.
import { b } from './b.js';

export const a = 'a';
export const a_sees_b = () => b();
