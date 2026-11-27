/**
 * VERIFY: a request to the image endpoint → the recipe it may make, or the answer that refuses it. A
 * method other than GET or HEAD is 405, a signature that does not sign the recipe path is the app's
 * own refusal, a path that is no recipe or names an original the endpoint may not read is 404, and a
 * URL with a query string is sent to the bare URL.
 *
 * @packageDocumentation
 */
import type { ServerApp } from '@ogygia/core/plugin';
import { parse_recipe, type ParsedRecipe } from './recipe.ts';

/** What the app signs for one recipe path (`<id>-<w>x<h>…/<tail>.<ext>`). */
export function message(path: string): string {
	return `image|${path}`;
}

function not_found(): Response {
	return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
}

/** The recipe a `method` request asks for at `url` (its path `rest` below the endpoint's prefix:
 *  `<sig>/<recipe path>`), or the answer. `originals` says whether a tail names an original the
 *  endpoint may read. */
export function verify(
	app: Pick<ServerApp<unknown>, 'verify' | 'deny'>,
	method: string,
	url: URL,
	rest: string,
	originals: { has(tail: string): boolean }
): ParsedRecipe | Response {
	if (method !== 'GET' && method !== 'HEAD')
		return new Response(null, {
			status: 405,
			headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' }
		});
	const slash = rest.indexOf('/');
	const sig = rest.slice(0, slash);
	const path = rest.slice(slash + 1);
	if (slash < 1 || !app.verify(message(path), sig)) return app.deny('sig');
	const recipe = parse_recipe(path);
	if (recipe === null || !originals.has(recipe.tail)) return not_found();
	if (url.search !== '')
		return new Response(null, {
			status: 308,
			headers: { location: url.pathname, 'cache-control': 'public, max-age=31536000, immutable' }
		});
	return recipe;
}
