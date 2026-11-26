/**
 * The image server realm. `setup` hands `<Img>` the URL of each file:
 *
 * - on a live server and in dev, a recipe's URL signed with the app's key in this plugin's own domain
 *   (`app.sign`: no expiry, so a recipe has one URL on every render, in every process, and a CDN
 *   keeps it forever), or the build's static file for a warmed preset;
 * - in Kit's prerender, every file is one the build makes: a static file under the app folder, named
 *   by its recipe alone, the same in every build with no key. Each recipe is noted on disk (the
 *   prerender runs in a worker) and its file started at once; the build's end writes every one and
 *   points the pages at them (./vite/build-files.ts). Until then the URL carries the build's mark, a
 *   host Kit's crawler does not follow: it would ask for a file not there yet under the app folder,
 *   which Kit answers 404 before any hook runs;
 * - in a page the build renders after its end wrote the files (an adapter's SPA fallback), the file
 *   the build wrote, with no mark (nothing would remove it), or the original where no prerendered
 *   page asked for that file.
 *
 * `request` is the endpoint that makes the signed files, in dev and on a live server.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import path from 'node:path';
import { building, dev } from '$app/environment';
import { defineServer, type ServerPlugin } from '@ogygia/core/plugin';
import { cache } from '@ogygia/machine';
import config from 'virtual:ogygia-image/config';
import sources from 'virtual:ogygia-image/sources';
import { said, warn } from './messages.ts';
import {
	built_file,
	built_url,
	encode_tail,
	IMAGE_PREFIX,
	parse_recipe,
	recipe_file,
	recipe_path,
	set_minter,
	source_tail,
	type ParsedRecipe,
	type Recipe
} from './recipe.ts';
import { build_handoff, note_built, note_origin, published, type BuildHandoff } from './store.ts';

const { base: BASE, assets: ASSETS } = config.paths;
const PREFIXES: readonly string[] = [ASSETS, BASE];

class Originals {
	#urls: ReadonlyMap<string, string>;

	constructor(list: Readonly<Record<string, string>>) {
		this.#urls = new Map(Object.values(list).map((url) => [source_tail(url, PREFIXES), url]));
	}

	has(tail: string): boolean {
		if (this.#urls.has(tail)) return true;
		const root = DEV_ROOT;
		return root !== null && published(tail) && fs.existsSync(path.join(root, tail));
	}

	/** The string Kit's `read()` takes for `tail`: the URL its import gave (`paths.assets` or base). */
	url(tail: string): string {
		return this.#urls.get(tail) ?? `${BASE}/${encode_tail(tail)}`;
	}
}

const DEV_ROOT: string | null = (dev && build_handoff()?.root) || null;
const ORIGINALS = new Originals(sources);

function message(path: string): string {
	return `image|${path}`;
}

function not_found(): Response {
	return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
}

function no_encoder(e: unknown): Response {
	said.once('image_no_encoder', () => warn('image_no_encoder', { reason: (e as Error).message }));
	return new Response('this server cannot make images', {
		status: 500,
		headers: { 'cache-control': 'no-store' }
	});
}

function original_of(recipe: ParsedRecipe): string {
	return ORIGINALS.url(recipe.tail);
}

let origin_unnoted: BuildHandoff | null = null;
const SIGNED_MAX = 10_000;

function root_relative(url: string): boolean {
	return url[0] === '/' && url[1] !== '/';
}

function prerendered(run: BuildHandoff, noted: Set<string>, recipe: Recipe): string {
	const path = recipe_path(recipe, source_tail(recipe.src, PREFIXES));
	if (!noted.has(path)) {
		noted.add(path);
		note_built(run.minted, path);
		const parsed = parse_recipe(path);
		if (parsed !== null && ORIGINALS.has(parsed.tail))
			// oxlint-disable-next-line ogygia/no-silent-failures -- a head start only: the build's end makes the file again and fails out loud
			void import('./settle.ts')
				.then((m) => m.prepare(parsed, recipe_file(parsed), original_of(parsed)))
				.catch(() => {});
	}
	const url = built_url(config.paths, recipe);
	return root_relative(url) ? run.mark + url : url;
}

const server: ServerPlugin<unknown> = defineServer<unknown>({
	setup(app) {
		const run = building ? build_handoff() : null;
		if (run?.written) {
			const written = run.written;
			set_minter((recipe) =>
				fs.existsSync(path.join(written, ...built_file(recipe).split('/')))
					? built_url(config.paths, recipe)
					: recipe.src
			);
			return;
		}
		if (run?.minted) {
			origin_unnoted = run;
			const noted = new Set<string>();
			set_minter((recipe) => prerendered(run, noted, recipe));
			return;
		}
		const signed = cache<string, string>({ name: 'image URLs', max: SIGNED_MAX });
		set_minter((recipe, built) => {
			if (built) return built_url(config.paths, recipe);
			const path = recipe_path(recipe, source_tail(recipe.src, PREFIXES));
			let url = signed.get(path);
			if (url === undefined) {
				url = `${BASE}${IMAGE_PREFIX}${app.sign(message(path))}/${path}`;
				signed.set(path, url);
			}
			return url;
		});
	},

	async request({ event, app }) {
		const run = origin_unnoted;
		if (run) {
			origin_unnoted = null;
			note_origin(run.minted, event.url.origin);
		}
		const at = BASE + IMAGE_PREFIX;
		const { pathname } = event.url;
		if (!pathname.startsWith(at)) return;
		const method = event.request.method;
		if (method !== 'GET' && method !== 'HEAD')
			return new Response(null, {
				status: 405,
				headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' }
			});
		const rest = pathname.slice(at.length);
		const slash = rest.indexOf('/');
		const sig = rest.slice(0, slash);
		const path = rest.slice(slash + 1);
		if (slash < 1 || !app.verify(message(path), sig)) return app.deny('sig');
		const recipe = parse_recipe(path);
		if (recipe === null || !ORIGINALS.has(recipe.tail)) return not_found();
		if (event.url.search !== '')
			return new Response(null, {
				status: 308,
				headers: { location: pathname, 'cache-control': 'public, max-age=31536000, immutable' }
			});
		let settle: typeof import('./settle.ts').settle;
		try {
			({ settle } = await import('./settle.ts'));
		} catch (e) {
			return no_encoder(e);
		}
		return settle(recipe, recipe_file(recipe), original_of(recipe));
	}
});
export default server;
