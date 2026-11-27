/**
 * SHARE CARDS: `import.meta.og.image.card('./Card.svelte', { width, height, fonts })` is a function
 * of props that returns an image descriptor, made from the component rendered with those props:
 *
 *   export const ShareCard = import.meta.og.image.card('./ShareCard.svelte', { width: 1200, height: 630, fonts: ['./serif.woff'] });
 *   return { share: ShareCard({ title: post.title }) };   // a +page.server.ts load
 *
 * The plugin writes each card as a module that hands {@link card} its spec. A card's source id is a
 * hash of its digest (every module and font it is made from, and the engine's versions), its size,
 * its props and the version of ogygia's draw, so a change to any of them names new files. Its files' URLs carry
 * the props (`.card/<card>/<props>`, ./recipe.ts), signed with the rest, so the endpoint renders only
 * the props the server named. Server only: the descriptor's `src` is a URL the server mints.
 *
 * @packageDocumentation
 */
import type { ImageDescriptor } from './descriptor.ts';
import { OgygiaError } from './messages.ts';
import { b64url_encode, mint, type Recipe } from './recipe.ts';
import { RenderError } from './render-messages.ts';
import { sha256 } from './sha256.ts';
import { CARD_DRAW_VERSION, ENCODER_VERSION } from './source-id.ts';

/** The most a card's props may take in its URLs: base64url characters of their JSON. */
export const PROPS_MAX = 2048;
const ID_LENGTH = 32;

/** A value a card's props may hold: what JSON holds. */
export type CardValue =
	| null
	| boolean
	| number
	| string
	| CardValue[]
	| { [key: string]: CardValue };

/** A card's props. */
export type CardProps = { [key: string]: CardValue };

/** A font a card is drawn with, as the plugin read it from the file. */
export interface CardFont {
	/** The family its CSS names it by. */
	name: string;
	weight: number;
	style: 'normal' | 'italic';
	/** The font file's asset URL. */
	src: string;
}

/** One card, as the plugin writes its module. */
export interface CardSpec {
	/** Its name in its files' URLs. */
	card: string;
	/** Its component's project path, for messages. */
	file: string;
	/** A hash of every module and font it is made from and the engine's versions. */
	digest: string;
	width: number;
	height: number;
	fonts: readonly CardFont[];
	/** The component rendered with `props`: its head (its CSS) and its body, as HTML. */
	html(props: CardProps): Promise<string>;
}

function refuse(file: string, at: string, why: string): never {
	throw new OgygiaError('image_card_props', { file, at, why });
}

function plain(value: object): boolean {
	const proto = Object.getPrototypeOf(value) as unknown;
	return proto === Object.prototype || proto === null;
}

function canonical(value: unknown, file: string, at: string): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string')
		return JSON.stringify(value);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) refuse(file, at, `${String(value)} is not a JSON number`);
		return JSON.stringify(value);
	}
	if (Array.isArray(value))
		return `[${value.map((v, i) => canonical(v, file, `${at}[${i}]`)).join(',')}]`;
	if (typeof value === 'object' && plain(value)) {
		const keys = Object.keys(value).sort();
		const parts = keys.map(
			(k) =>
				`${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], file, `${at}.${k}`)}`
		);
		return `{${parts.join(',')}}`;
	}
	const kind = typeof value === 'object' ? (value.constructor?.name ?? 'object') : typeof value;
	return refuse(file, at, `a ${kind} is not JSON`);
}

/** `props` as the one JSON text its files' URLs carry (keys sorted), or `image_card_props` when they
 *  are not JSON or take more than {@link PROPS_MAX} characters there. */
export function card_json(file: string, props: unknown): string {
	if (props === null || typeof props !== 'object' || Array.isArray(props) || !plain(props))
		refuse(file, 'props', 'the props must be one plain object');
	const json = canonical(props, file, 'props');
	const size = b64url_encode(json).length;
	if (size > PROPS_MAX)
		refuse(file, 'props', `they take ${size} characters in a URL, past ${PROPS_MAX}`);
	return json;
}

function b64url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The source id of `spec`'s card with props `json`: `c` and a hash of its digest, size, props
 *  and the versions of the encoder and of the draw ({@link CARD_DRAW_VERSION}). */
export function card_id(spec: Pick<CardSpec, 'digest' | 'width' | 'height'>, json: string): string {
	const text = `card\0${spec.digest}\0${spec.width}x${spec.height}\0${json}\0encoder ${ENCODER_VERSION}\0draw ${CARD_DRAW_VERSION}`;
	return `c${b64url(sha256(new TextEncoder().encode(text))).slice(0, ID_LENGTH)}`;
}

/** The descriptor maker of one card: `(props) => ImageDescriptor`, whose `src` is its own-size PNG. */
export function card(spec: CardSpec): (props: CardProps) => ImageDescriptor {
	return (props) => {
		const json = card_json(spec.file, props);
		const tail = `${spec.card}/${b64url_encode(json)}`;
		const recipe: Recipe = {
			id: card_id(spec, json),
			src: '',
			width: spec.width,
			height: spec.height,
			format: 'png',
			from: 'card',
			card: tail,
			source: { format: 'png' }
		};
		const src = mint(recipe, false);
		if (src === null) throw new RenderError('image_no_server');
		return {
			id: recipe.id,
			src,
			width: spec.width,
			height: spec.height,
			format: 'png',
			from: 'card',
			card: tail
		};
	};
}
