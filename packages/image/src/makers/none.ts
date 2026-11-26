/**
 * The maker of an app whose encoders make no file at its endpoint: every ask fails, coded
 * (`image_settle_failed`, saying why). Holds nothing a runtime could lack.
 *
 * @packageDocumentation
 */
import type { Maker } from '../maker.ts';

/** One at a time: each ask fails at once. */
export const parallel: Maker['parallel'] = 1;

/** Fails: no encoder makes files here. */
export const make: Maker['make'] = () =>
	Promise.reject(new Error('no encoder in image({ encoder }) makes files at this server'));

/** Nothing is kept. */
export const store: Maker['store'] = null;

/** No card drawn here names an image. */
export const fit: Maker['fit'] = null;
