/**
 * A card's original at the endpoint: its own-size PNG, drawn from the props its tail names with the
 * card's fonts (read with Kit's `read()`, like any original). The card is found by name in the
 * build's list (`virtual:ogygia-image/cards`); one whose digest changed since the URL was minted (a
 * later deploy, an edit in dev) is not the source the URL names, so it is never drawn under it. The
 * images its markup names are read by the endpoint (./images.ts): an asset with Kit's `read()`, a URL
 * through the endpoint's remote fetch.
 *
 * @packageDocumentation
 */
import { read } from '$app/server';
import config from 'virtual:ogygia-image/config';
import { card_module, engine } from 'virtual:ogygia-image/cards';
import { card_id, type CardProps, type CardSpec } from '../card.ts';
import { Changed } from '../reader.ts';
import { card_of_tail } from '../recipe.ts';
import { card_image_reader, type CardImageRead } from './images.ts';

/** A card's module, as the endpoint loads it: its spec, and its engine where one runs. */
export interface CardModule {
	spec: CardSpec | null;
	png?: (
		props: CardProps,
		fonts: readonly ArrayBuffer[],
		images: CardImageRead
	) => Promise<Uint8Array>;
}

/** The tail names no card this server has: the endpoint answers 404. */
export class NoCard extends Error {}

/** Whether this server draws cards (no: a runtime satori and resvg do not run in). */
export const draws: boolean = engine;

const PREFIXES: readonly string[] = [config.paths.assets, config.paths.base];

/** The endpoint's reader of a card's images: an asset with Kit's `read()`, a URL with `remote`
 *  (the endpoint's guarded fetch; null: no `image({ remote })`). */
export function endpoint_images(remote: ((url: URL) => Promise<Uint8Array>) | null): CardImageRead {
	return card_image_reader(
		PREFIXES,
		async (_tail, src) => new Uint8Array(await read(src).arrayBuffer()),
		remote
	);
}

/** The own-size PNG of the card `tail` names, when it is the source `id`, its images read by
 *  `images`; {@link NoCard} when there is no such card, {@link Changed} when the card is not that
 *  source any more. */
export async function card_original(
	tail: string,
	id: string,
	images: CardImageRead
): Promise<Uint8Array> {
	const named = card_of_tail(tail);
	if (named === null) throw new NoCard('its tail names no card');
	const m = await card_module(named.card);
	if (m === null || !m.spec) throw new NoCard(`no card is named ${named.card}`);
	if (card_id(m.spec, named.props) !== id) throw new Changed();
	if (!m.png) throw new NoCard('this server draws no card');
	const fonts = await Promise.all(m.spec.fonts.map((f) => read(f.src).arrayBuffer()));
	return m.png(JSON.parse(named.props) as CardProps, fonts, images);
}
