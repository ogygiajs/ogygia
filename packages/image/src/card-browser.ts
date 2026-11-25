/**
 * A share card in the browser: it only refuses. A card's descriptor names a URL the server mints, so
 * a card is made in a server load (or a page's server render), and its descriptor passed on.
 *
 * @packageDocumentation
 */
import type { ImageDescriptor } from './descriptor.ts';
import { RenderError } from './render-messages.ts';

/** A card's descriptor maker in the browser: `image_no_server`. */
export function card_in_browser(): ImageDescriptor {
	throw new RenderError('image_no_server');
}
