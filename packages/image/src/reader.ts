/**
 * The READER: an original's bytes, for the maker. A file under `src/` is read with Kit's `read()`
 * (the image server realm imports every image under `src/`, so each is one of the server's assets in
 * dev, in the prerender and on any adapter), and checked against the id the recipe names: an original
 * edited since the page named it is not the source, so its new pixels never go out under the old
 * name.
 *
 * @packageDocumentation
 */
import { read } from '$app/server';
import { source_id } from './source-id.ts';

/** The original is not the source a recipe names any more. */
export class Changed extends Error {}

/** The bytes of `original` (the asset URL Kit's `read()` takes), when they are the source `id`;
 *  else {@link Changed}. */
export async function read_original(original: string, id: string): Promise<Uint8Array> {
	const bytes = new Uint8Array(await read(original).arrayBuffer());
	if ((await source_id(bytes)) !== id) throw new Changed();
	return bytes;
}
