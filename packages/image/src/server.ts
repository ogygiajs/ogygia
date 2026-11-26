/**
 * The image server realm. `setup` hands `<Img>` the URL of each file:
 *
 * - on a live server and in dev, the build's static file for a warmed preset, the encoder's own link
 *   (`virtual:ogygia-image/namer`), or else a recipe's URL signed with the app's key in this plugin's
 *   own domain (`app.sign`: no expiry, so a recipe has one URL on every render, in every process, and
 *   a CDN keeps it forever);
 * - in Kit's prerender, every file is one the build makes: a static file under the app folder, named
 *   by its recipe alone, the same in every build with no key. Each recipe is noted on disk (the
 *   prerender runs in a worker) and the build is told, which starts its file at once; the build's
 *   end writes every one and points the pages at them (./vite/build-files.ts). The prerender makes
 *   no file itself. Until then the URL carries the build's mark, a
 *   host Kit's crawler does not follow: it would ask for a file not there yet under the app folder,
 *   which Kit answers 404 before any hook runs;
 * - in a page the build renders after its end wrote the files (an adapter's SPA fallback), the file
 *   the build wrote, with no mark (nothing would remove it), or the original where no prerendered
 *   page asked for that file.
 *
 * `request` is the endpoint that makes the signed files, in dev and on a live server: verify
 * (./verify.ts), then settle (./settle.ts). What the realm reads and notes on disk (./on-disk.ts) is
 * loaded in dev and in the build only, from `setup`; `request`, which comes before every render,
 * waits for it, so the module itself awaits nothing.
 *
 * @packageDocumentation
 */
import { building, dev } from '$app/environment';
import {
	defineServer,
	type HandleContext,
	type ResolveOptions,
	type ServerApp,
	type ServerPlugin
} from '@ogygia/core/plugin';
import { cache } from '@ogygia/machine';
import config from 'virtual:ogygia-image/config';
import { name } from 'virtual:ogygia-image/namer';
import { remote as REMOTE } from 'virtual:ogygia-image/remote';
import sources, { remote } from 'virtual:ogygia-image/sources';
import { build_handoff, published, type BuildHandoff } from './handoff.ts';
import { said, warn } from './messages.ts';
import {
	built_file,
	built_url,
	CARD_TAIL,
	card_of_tail,
	encode_tail,
	IMAGE_PREFIX,
	recipe_file,
	recipe_path,
	recipe_tail,
	REMOTE_TAIL,
	remote_of_tail,
	set_minter,
	source_tail,
	type ParsedRecipe,
	type Recipe
} from './recipe.ts';
import { RemoteHosts } from './remote-hosts.ts';
import { unshown_share_images } from './share-rule.ts';
import { message, verify } from './verify.ts';

type OnDisk = typeof import('./on-disk.ts');
let DISK: OnDisk | null = null;

const { base: BASE, assets: ASSETS } = config.paths;
const PREFIXES: readonly string[] = [ASSETS, BASE];

class Originals {
	#urls: ReadonlyMap<string, string>;
	#remote: ReadonlySet<string>;

	constructor(list: Readonly<Record<string, string>>, fetched: readonly string[] | string) {
		this.#urls = new Map(Object.values(list).map((url) => [source_tail(url, PREFIXES), url]));
		this.#remote = new Set(typeof fetched === 'string' ? [] : fetched);
	}

	has(tail: string): boolean {
		if (tail.startsWith(REMOTE_TAIL)) return listed(tail);
		if (tail.startsWith(CARD_TAIL)) return card_of_tail(tail) !== null;
		if (this.#urls.has(tail)) return true;
		if (tail.startsWith(REMOTE_ASSETS)) {
			const name = REMOTE_ASSET_RE.exec(tail.slice(REMOTE_ASSETS.length))?.[1];
			if (name !== undefined && this.#remote.has(name)) return true;
		}
		const run = DEV_RUN;
		if (run === null || DISK === null) return false;
		if (published(tail)) return DISK.exists(run.root, tail);
		return DISK.is_remote(run.root, run.remote, tail);
	}

	url(tail: string): string {
		return this.#urls.get(tail) ?? `${dev ? BASE : ASSETS || BASE}/${encode_tail(tail)}`;
	}
}

const REMOTE_ASSETS = `${config.paths.app_dir}/immutable/assets/`;
const REMOTE_ASSET_RE = /^([0-9a-f]{32})\.[\w-]+\.(?:png|jpe?g|webp|avif|gif|tiff?)$/;
const DEV_RUN: BuildHandoff | null = dev ? root_handoff(build_handoff()) : null;

function root_handoff(run: BuildHandoff | null): BuildHandoff | null {
	return run !== null && run.root !== '' ? run : null;
}
const ORIGINALS = new Originals(sources, remote);
const HOSTS: RemoteHosts | null = REMOTE === null ? null : new RemoteHosts(REMOTE.hosts);

function unlisted_why(url: URL | null): string {
	if (HOSTS === null) return 'image({ remote }) is not set';
	return url === null ? 'its tail names no http(s) URL' : 'its host is not in remote.hosts';
}

function listed(tail: string): boolean {
	const url = remote_of_tail(tail);
	if (url !== null && HOSTS?.allows(url)) return true;
	const href = url?.href ?? tail;
	said.once(`image_remote_refused ${href}`, () =>
		warn('image_remote_refused', { url: href, status: 404, reason: unlisted_why(url) })
	);
	return false;
}

class DiskHalf {
	#ready: Promise<void> | null = null;
	#unnoted: BuildHandoff | null = null;

	load(then: (disk: OnDisk) => void): void {
		this.#ready = import('./on-disk.ts').then((disk) => {
			DISK = disk;
			then(disk);
		});
	}

	async ready(): Promise<void> {
		if (this.#ready !== null) await this.#ready;
	}

	note_origin_of(run: BuildHandoff): void {
		this.#unnoted = run;
	}

	note_origin(origin: string): void {
		const run = this.#unnoted;
		if (run === null || DISK === null) return;
		this.#unnoted = null;
		DISK.note_origin(run.minted, origin);
	}
}

const DISK_HALF = new DiskHalf();

function no_encoder(e: unknown): Response {
	said.once('image_no_encoder', () => warn('image_no_encoder', { reason: (e as Error).message }));
	return new Response('this server cannot make images', {
		status: 500,
		headers: { 'cache-control': 'no-store' }
	});
}

function original_of(recipe: ParsedRecipe): string {
	if (card_of_tail(recipe.tail) !== null) return built_url(config.paths, recipe);
	return ORIGINALS.url(recipe.tail);
}

const SIGNED_MAX = 10_000;

function root_relative(url: string): boolean {
	return url[0] === '/' && url[1] !== '/';
}

function prerendered(disk: OnDisk, run: BuildHandoff, noted: Set<string>, recipe: Recipe): string {
	const path = recipe_path(recipe, recipe_tail(recipe, PREFIXES));
	if (!noted.has(path)) {
		noted.add(path);
		disk.note_built(run.minted, path);
	}
	const url = built_url(config.paths, recipe);
	return root_relative(url) ? run.mark + url : url;
}

function start(app: ServerApp<unknown>, disk: OnDisk | null): void {
	const run = building && disk !== null ? build_handoff() : null;
	if (disk !== null && run?.written) {
		const written = run.written;
		set_minter((recipe) =>
			disk.exists(written, built_file(recipe)) ? built_url(config.paths, recipe) : recipe.src
		);
		return;
	}
	if (disk !== null && run?.minted) {
		DISK_HALF.note_origin_of(run);
		const noted = new Set<string>();
		set_minter((recipe) => prerendered(disk, run, noted, recipe));
		return;
	}
	const signed = cache<string, string>({ name: 'image URLs', max: SIGNED_MAX });
	set_minter((recipe, built) => {
		if (built) return built_url(config.paths, recipe);
		const link = recipe.from === 'card' ? null : name(recipe);
		if (link !== null) return link;
		const path = recipe_path(recipe, recipe_tail(recipe, PREFIXES));
		let url = signed.get(path);
		if (url === undefined) {
			url = `${BASE}${IMAGE_PREFIX}${app.sign(message(path))}/${path}`;
			signed.set(path, url);
		}
		return url;
	});
}

const SAID_SHARE_MAX = 256;
const said_share = cache<string, true>({ name: 'share images said', max: SAID_SHARE_MAX });

function share_rule(
	ctx: HandleContext<unknown>,
	next: (options?: ResolveOptions) => Promise<Response>
): Promise<Response> {
	const path = ctx.event.url.pathname;
	return next({
		transformPageChunk: ({ html }) => {
			for (const url of unshown_share_images(html))
				if (said_share.get(url) === undefined) {
					said_share.set(url, true);
					warn('image_share_format', { path, url });
				}
			return html;
		}
	});
}

const server: ServerPlugin<unknown> = defineServer<unknown>({
	...(dev ? { handle: share_rule } : {}),
	setup(app) {
		if (dev || building) DISK_HALF.load((disk) => start(app, disk));
		else start(app, null);
	},

	async request({ event, app }) {
		await DISK_HALF.ready();
		DISK_HALF.note_origin(event.url.origin);
		const at = BASE + IMAGE_PREFIX;
		const { pathname } = event.url;
		if (!pathname.startsWith(at)) return;
		const recipe = verify(
			app,
			event.request.method,
			event.url,
			pathname.slice(at.length),
			ORIGINALS
		);
		if (recipe instanceof Response) return recipe;
		let settle: typeof import('./settle.ts').settle;
		try {
			({ settle } = await import('./settle.ts'));
		} catch (e) {
			return no_encoder(e);
		}
		return settle(recipe, recipe_file(recipe), original_of(recipe), event.platform);
	}
});
export default server;
