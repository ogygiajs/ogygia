import { OgygiaError } from '../messages/core.ts';
import { HOOK_RELOAD_NEEDED } from './client-plugins.ts';
import { slots } from './slots.ts';

/** `url` resolved against the page, without a retry's `og-retry` mark. */
function file_of(url: string): string {
	const u = new URL(url, document.baseURI);
	u.searchParams.delete('og-retry');
	return u.href;
}

/** The regions on the page whose own file (`src`) is `url`, a retry's mark aside. */
export function regions_of_file(url: string): Element[] {
	const file = file_of(url);
	return [...document.querySelectorAll('ogygia-region[src]')].filter(
		(el) => file_of(el.getAttribute('src')!) === file
	);
}

/** A chunk no retry can load: the page says it needs a reload, and a plugin's `reloadNeeded` hears
 *  the chunk, its error and the regions whose own file it is. */
export function say_reload_needed(url: string, error: unknown): void {
	console.error(new OgygiaError('chunk_reload_needed', { url }), error);
	if (HOOK_RELOAD_NEEDED)
		slots.hooks?.reloadNeeded?.({ url, error, regions: regions_of_file(url) });
}
