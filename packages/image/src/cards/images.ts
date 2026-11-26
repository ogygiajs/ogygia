/**
 * THE IMAGES A CARD DRAWS. satori would fetch every `<img>` and `url()` a card's markup names with the
 * global `fetch`: any address, no size cap, no time limit. So before satori runs, each one is read
 * by the card's realm and handed over as a `data:` URL ogygia made itself:
 *
 * - an asset of the build (a root-relative URL, or one under `paths.assets`): its bytes, read the
 *   way the image endpoint reads an original;
 * - an `http(s)` URL: fetched through the same guard as `remoteImage()` (`image({ remote })`'s
 *   hosts, the public-address rule for `*.` hosts, `maxBytes`, `timeout`);
 * - anything else, or bytes that are no PNG, JPEG, GIF, WebP or AVIF: `image_card_source`.
 *
 * @packageDocumentation
 */
import { OgygiaError } from '../messages.ts';
import { source_tail } from '../recipe.ts';

/** How a card's realm reads one image its markup names, by the URL the markup wrote. */
export type CardImageRead = (src: string) => Promise<Uint8Array>;

/** The reader of a realm that reads no image: every one is refused. */
export const no_images: CardImageRead = () =>
	Promise.reject(new Error('this card is drawn with no image reader'));

/** A realm's reader: `local` reads an asset of the build by its tail (and the URL as written),
 *  `remote` fetches a URL through `image({ remote })`'s guard (null: no `remote` is set). */
export function card_image_reader(
	prefixes: readonly string[],
	local: (tail: string, src: string) => Promise<Uint8Array>,
	remote: ((url: URL) => Promise<Uint8Array>) | null
): CardImageRead {
	return (src) => {
		const own = prefixes.some((p) => p !== '' && src.startsWith(`${p}/`));
		if (own || (src.startsWith('/') && !src.startsWith('//')))
			return local(source_tail(src, prefixes), src);
		let url: URL | null = null;
		try {
			url = new URL(src);
			// oxlint-disable-next-line ogygia/no-silent-failures -- a src that is no absolute URL is refused just below, saying what it must be
		} catch {}
		if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:'))
			return Promise.reject(
				new Error('it is no asset URL of this build (root-relative) and no http(s) URL')
			);
		if (remote === null)
			return Promise.reject(new Error('image({ remote }) is not set, so a card fetches no URL'));
		return remote(url);
	};
}

type Node = { type?: unknown; props?: { [prop: string]: unknown } };

const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

function each_src(node: unknown, visit: (src: string) => void): void {
	if (Array.isArray(node)) {
		for (const n of node) each_src(n, visit);
		return;
	}
	if (node === null || typeof node !== 'object') return;
	const { type, props } = node as Node;
	if (props === undefined) return;
	if (type === 'img' && typeof props.src === 'string') visit(props.src);
	const style = props.style;
	if (style !== null && typeof style === 'object')
		for (const value of Object.values(style))
			if (typeof value === 'string' && value.includes('url('))
				for (const m of value.matchAll(URL_RE)) visit(m[2]!);
	each_src(props.children, visit);
}

function with_data(node: unknown, data: ReadonlyMap<string, string>): unknown {
	if (Array.isArray(node)) return node.map((n) => with_data(n, data));
	if (node === null || typeof node !== 'object') return node;
	const { type, props } = node as Node;
	if (props === undefined) return node;
	const next: { [prop: string]: unknown } = { ...props };
	if (type === 'img' && typeof props.src === 'string') next.src = data.get(props.src) ?? props.src;
	const style = props.style;
	if (style !== null && typeof style === 'object')
		next.style = Object.fromEntries(
			Object.entries(style).map(([k, v]) => [
				k,
				typeof v === 'string' && v.includes('url(')
					? v.replace(URL_RE, (whole, _q: string, src: string) =>
							data.has(src) ? `url(${data.get(src)!})` : whole
						)
					: v
			])
		);
	if (props.children !== undefined) next.children = with_data(props.children, data);
	return { ...node, props: next };
}

/** The image type `bytes` start like, or null: PNG, JPEG, GIF, WebP, AVIF. */
export function card_image_type(bytes: Uint8Array): string | null {
	const at = (i: number, text: string) =>
		[...text].every((c, k) => bytes[i + k] === c.charCodeAt(0));
	if (at(0, '\x89PNG\r\n\x1a\n')) return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
	if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
	if (at(4, 'ftypavif') || at(4, 'ftypavis')) return 'image/avif';
	return null;
}

function refused(file: string, src: string, reason: string): Error {
	return new OgygiaError('image_card_source', { file, src, reason });
}

/** `tree` with every image it names read by `read` and written as a `data:` URL; a `data:` URL is
 *  kept as it is. One `read` cannot read is `image_card_source` (a coded refusal of the realm's own,
 *  such as `image_remote_host` at build, stays as it is). */
export async function inline_images<T>(tree: T, file: string, read: CardImageRead): Promise<T> {
	const srcs = new Set<string>();
	each_src(tree, (src) => {
		if (!src.startsWith('data:')) srcs.add(src);
	});
	if (srcs.size === 0) return tree;
	const data = new Map<string, string>();
	await Promise.all(
		[...srcs].map(async (src) => {
			let bytes: Uint8Array;
			try {
				bytes = await read(src);
			} catch (e) {
				const code = (e as { code?: unknown }).code;
				if (typeof code === 'string' && code.startsWith('image_')) throw e;
				throw refused(file, src, (e as Error).message);
			}
			const type = card_image_type(bytes);
			if (type === null) throw refused(file, src, 'its bytes are no PNG, JPEG, GIF, WebP or AVIF');
			data.set(src, `data:${type};base64,${Buffer.from(bytes).toString('base64')}`);
		})
	);
	return with_data(tree, data) as T;
}
