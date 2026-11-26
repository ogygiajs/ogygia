/**
 * What the plugin hands the processes of one `vite build` or dev server, and which originals the
 * endpoint may read. Reads the environment only: no file system, so the server realm loads it in any
 * runtime.
 *
 * @packageDocumentation
 */
import { DEFAULT_AVIF_EFFORT } from './config.ts';

/** What the plugin hands the processes of one `vite build` or dev server (and Kit's prerender
 *  worker, which inherits the environment): the store's folder, the file the prerender notes its
 *  recipes in, and the build's mark. Internal: the plugin writes it, nothing else should. */
export const BUILD_ENV = '__OGYGIA_IMAGE_BUILD';

/** The build's handoff, when this process runs under the plugin. */
export interface BuildHandoff {
	/** The store's folder. */
	store: string;
	/** The file every recipe a prerendered page names is noted in, one per line (its path below
	 *  the endpoint's prefix, unsigned: the build's end makes each). */
	minted: string;
	/** What a prerendered page's file URL starts with until the build's end makes the file: a host no
	 *  crawler follows (`//<random>.ogygia.invalid`), removed from every prerendered page then. Empty
	 *  outside a build. */
	mark: string;
	/** Once the build's end wrote its files: the client output's app folder they sit under (empty
	 *  until then, with no notes and no mark after). A page rendered after that (an adapter's SPA
	 *  fallback) names those files as they are. */
	written: string;
	/** Once the build's end wrote its files: the source id each remote image's files were named by
	 *  instead (its bytes', in place of its URL's), by the URL's id. */
	renamed?: Readonly<Record<string, string>>;
	/** The app's root (Vite's `root`). */
	root: string;
	/** The AVIF effort the build makes its files at (`sharp({ effort: { avif } })`). */
	avif_effort: number;
	/** The folder remote images are fetched into, each named {@link REMOTE_NAME_RE} and its
	 *  extension. */
	remote: string;
}

/** The name of a remote image's file in the build cache, before its extension: a hash of its
 *  URL. */
export const REMOTE_NAME_RE: RegExp = /^[0-9a-f]{32}$/;

/** The handoff the plugin left in the environment, or null on a live server. */
export function build_handoff(): BuildHandoff | null {
	const raw = typeof process === 'undefined' ? undefined : process.env[BUILD_ENV];
	if (!raw) return null;
	const v = JSON.parse(raw) as Partial<BuildHandoff>;
	if (typeof v.store !== 'string' || typeof v.minted !== 'string') return null;
	return {
		store: v.store,
		minted: v.minted,
		mark: typeof v.mark === 'string' ? v.mark : '',
		written: typeof v.written === 'string' ? v.written : '',
		root: typeof v.root === 'string' ? v.root : '',
		avif_effort: typeof v.avif_effort === 'number' ? v.avif_effort : DEFAULT_AVIF_EFFORT,
		remote: typeof v.remote === 'string' ? v.remote : '',
		...(v.renamed !== null && typeof v.renamed === 'object' ? { renamed: v.renamed } : {})
	};
}

/** Images under `src/` that are never published: the server's own folder and test files. The
 *  plugin's sources glob leaves out the same. */
export const UNPUBLISHED_RE: RegExp =
	/^src\/lib\/server\/|(?:^|\/)__tests__\/|\.(?:test|spec)\.[^/]+$/;

const RASTER_RE = /\.(?:png|jpe?g|webp|avif|gif|tiff?)$/i;

/** Is `rel` (a path from the app's root) an original the image endpoint may read: a raster under
 *  `src/` that is published (what the sources glob takes)? */
export function published(rel: string): boolean {
	return rel.startsWith('src/') && RASTER_RE.test(rel) && !UNPUBLISHED_RE.test(rel);
}
