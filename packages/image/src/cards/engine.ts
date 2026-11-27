/**
 * THE CARD ENGINE: one card's own-size PNG from its component's HTML. The HTML (the component's
 * scoped CSS in its head, its markup in its body) becomes satori's element tree (satori-html, which
 * applies the CSS to each element), satori lays it out and draws it as SVG with the card's fonts, and
 * resvg turns the SVG into a PNG. All three are optional peers the app installs; they load on the
 * first card made, so an app with no card loads none of them.
 *
 * @packageDocumentation
 */
import { decodeText } from '@ogygia/core/plugin/utils';
import { flights, STALE } from '@ogygia/machine';
import { OgygiaError } from '../messages.ts';
import type { CardProps, CardSpec } from '../card.ts';
import type { ImageFit } from '../maker.ts';
import {
	drawable,
	inline_images,
	no_images,
	type CardImageFit,
	type CardImageRead
} from './images.ts';

/** The packages a card is made with, as an app installs them. */
export const ENGINE_PACKAGES: readonly string[] = ['satori', 'satori-html', '@resvg/resvg-js'];

interface SatoriNode {
	type: string;
	props: { children?: unknown; [prop: string]: unknown };
}

interface Engine {
	satori: (
		node: SatoriNode,
		options: {
			width: number;
			height: number;
			fonts: { name: string; data: ArrayBuffer; weight: number; style: string }[];
		}
	) => Promise<string>;
	html: (markup: string) => SatoriNode;
	Resvg: new (
		svg: string,
		options: { fitTo: { mode: 'width'; value: number } }
	) => { render(): { asPng(): Uint8Array } };
}

async function load_engine(): Promise<Engine> {
	const missing: string[] = [];
	const at = <T>(p: Promise<T>, name: string): Promise<T | null> =>
		p.catch(() => {
			missing.push(name);
			return null;
		});
	const [satori, html, resvg] = await Promise.all([
		at(import('satori'), 'satori'),
		at(import('satori-html'), 'satori-html'),
		at(import('@resvg/resvg-js'), '@resvg/resvg-js')
	]);
	if (satori === null || html === null || resvg === null)
		throw new OgygiaError('image_card_engine_missing', { missing: missing.join(', ') });
	return {
		satori: satori.default as unknown as Engine['satori'],
		html: html.html as unknown as Engine['html'],
		Resvg: resvg.Resvg as unknown as Engine['Resvg']
	};
}

const engines = flights.keyed<{ engine: 'satori' }>()<'engine', never, Promise<Engine>>({
	name: 'card engine',
	key: ['engine'],
	keep: Infinity,
	run: load_engine
});

/** satori, satori-html and resvg, loaded once; `image_card_engine_missing` naming any the app has
 *  not installed. */
export async function engine(): Promise<Engine> {
	const loaded = await engines.get({ engine: 'satori' });
	if (loaded === STALE) throw new Error('the card engine was dropped before it loaded');
	return loaded;
}

function fit_of(spec: CardSpec, fit: ImageFit | null): CardImageFit | null {
	return fit === null ? null : (bytes) => fit(bytes, spec.width, spec.height);
}

function decoded(node: unknown): unknown {
	if (typeof node === 'string') return decodeText(node);
	if (Array.isArray(node)) return node.map(decoded);
	if (node === null || typeof node !== 'object') return node;
	const { props } = node as SatoriNode;
	if (props === undefined) return node;
	const { tw: _, children, ...own } = props;
	const next: { [prop: string]: unknown } = {};
	for (const [key, value] of Object.entries(own)) {
		if (typeof value === 'string') next[key] = decodeText(value);
		else if (key === 'style' && value !== null && typeof value === 'object')
			next[key] = Object.fromEntries(
				Object.entries(value).map(([k, v]) => [k, typeof v === 'string' ? decodeText(v) : v])
			);
		else next[key] = value;
	}
	if (children !== undefined) next.children = decoded(children);
	return { ...node, props: next };
}

const PROPERTY_RE = /CSS property "([^"]+)"|Invalid `([^`]+)` value|explicit "(display)/;

function css_error(spec: CardSpec, e: unknown): unknown {
	const reason = e instanceof Error ? e.message : String(e);
	const m = PROPERTY_RE.exec(reason);
	if (m === null) return e;
	return new OgygiaError('image_card_css', {
		file: spec.file,
		property: m[1] ?? m[2] ?? m[3] ?? null,
		reason
	});
}

/** The element tree satori draws for `html`: the component's markup with its CSS applied, and its
 *  text as the page would show it. */
export async function card_tree(html: string): Promise<SatoriNode> {
	const { html: to_tree } = await engine();
	return decoded(to_tree(html.replace(/\s+/g, ' '))) as SatoriNode;
}

/** `spec`'s card with `props`, as its own-size PNG; `fonts` are the bytes of `spec.fonts`, in
 *  order. Every image its markup names (an `<img>`, a style's `url()`) is read by `images`, the
 *  card's realm (../cards/images.ts: an asset of the build, or a URL fetched under
 *  `image({ remote })`), fitted to the card by `fit` (the realm's sharp, ./fit.ts; null: one image
 *  is `image_card_source`) and handed satori as bytes; the tree satori
 *  draws is checked to hold no other address, so satori fetches nothing. One `images` cannot read,
 *  or with none given, fails `image_card_source`. A style satori cannot draw fails
 *  `image_card_css`. */
export async function card_png(
	spec: CardSpec,
	props: CardProps,
	fonts: readonly ArrayBuffer[],
	images: CardImageRead = no_images,
	fit: ImageFit | null = null
): Promise<Uint8Array> {
	const { satori, Resvg } = await engine();
	const tree = await inline_images(
		await card_tree(await spec.html(props)),
		spec.file,
		images,
		fit_of(spec, fit)
	);
	drawable(tree, spec.file);
	let svg: string;
	try {
		svg = await satori(tree, {
			width: spec.width,
			height: spec.height,
			fonts: spec.fonts.map((f, i) => ({
				name: f.name,
				data: fonts[i]!,
				weight: f.weight,
				style: f.style
			}))
		});
	} catch (e) {
		throw css_error(spec, e);
	}
	return new Uint8Array(
		new Resvg(svg, { fitTo: { mode: 'width', value: spec.width } }).render().asPng()
	);
}
