import { dedent } from '../dedent.ts';

/**
 * `virtual:ogygia/manifest` emitter — a legacy stub. Hydrate modules are loaded via
 * `<ogygia-region entry>` URLs, not this map; only the `dev` flag is still read.
 */
export function manifest_module(is_dev: boolean): string {
	return dedent`
		export const dev = ${is_dev ? 'true' : 'false'};
		export const regions = {};
	`;
}
