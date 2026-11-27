/**
 * The namer of an encoder with no links of its own (sharp): every live file is the endpoint's, so it
 * names none. The server signs the endpoint's URL; the browser cannot.
 *
 * @packageDocumentation
 */
import type { Namer } from '../recipe.ts';

/** No link: the endpoint makes every live file. */
export const name: Namer = () => null;
