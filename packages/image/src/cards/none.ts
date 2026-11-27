/**
 * The list of cards of a server that draws none (an edge runtime, where satori and resvg do not
 * run): a card's file is the build's, served from the platform's static files (../settle.ts).
 *
 * @packageDocumentation
 */
import type { CardModule } from './read.ts';

/** This server draws no card. */
export const engine = false;

/** No card is drawn here. */
export function card_module(): Promise<CardModule | null> {
	return Promise.resolve(null);
}
