/**
 * The sharp maker (Node): encodes with sharp, and keeps its files on disk: in the build cache's
 * folder in the build and the dev server, in a folder under the system's temporary folder on a live
 * server (../store.ts). Loaded on the first image request only: a server that never serves one never
 * loads sharp. This is the default AVIF effort's; another is ./sharp-at.ts.
 *
 * @packageDocumentation
 */
import { DEFAULT_AVIF_EFFORT } from '../config.ts';
import type { ImageFit, MadeStore, Maker } from '../maker.ts';
import { sharp_maker } from './sharp-at.ts';

const maker = sharp_maker(DEFAULT_AVIF_EFFORT);

/** How many files it makes at once: half the machine's cores, from one to four. */
export const parallel: number = maker.parallel;

/** One recipe's file from its original's bytes. */
export const make: Maker['make'] = maker.make;

/** The build cache's store in the build and the dev server, else the live server's. */
export const store: MadeStore | null = maker.store;

/** A card's images fitted to the card with sharp. */
export const fit: ImageFit = maker.fit;
